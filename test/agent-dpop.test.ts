import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SignJWT, calculateJwkThumbprint, exportJWK, generateKeyPair, type JWK } from 'jose';
import { eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { withTestDb, seedMinimal, type TestDb } from './harness';

/**
 * Proof of possession, from the outside.
 *
 * THE BUG THIS SUITE EXISTS FOR. Descope advertises DPoP on the Inbound App, so a Poppy
 * agent binds its access token to a key and sends `Authorization: DPoP <token>`. The store
 * matched only `Bearer`, decided nothing had been sent, and answered 401 "This endpoint
 * needs an access token the customer approved for their assistant" — to an agent that was
 * holding one. The agent read that as an expired session, refreshed, and was refused again.
 *
 * So the first test here is the one that was failing in production, and the rest are the
 * reason the fix is a check rather than a wider regex: a bound token accepted without its
 * proof is a bearer token again, and anyone who captured it could spend it.
 */

const ORIGIN = 'https://northbound.camp';
const PATH = '/api/agent/v1/orders';

let tdb: TestDb;
let ids: Awaited<ReturnType<typeof seedMinimal>>;

const resolveAgentToken = vi.fn();

vi.mock('@/db/client', () => ({
  get db() {
    return (globalThis as { __testDb?: unknown }).__testDb;
  },
}));

vi.mock('@/lib/agentSession/descope', () => ({
  resolveAgentToken: (token: string) => resolveAgentToken(token),
  inspectAgentToken: async (token: string) => {
    const session = await resolveAgentToken(token);
    return session ? { session } : { session: null, reason: 'not a token this test accepts' };
  },
  descopeIssuer: async () => 'https://auth.northbound.camp/v1/apps/P1',
}));

/** A key pair standing in for the one a Personal Agent generates and keeps. */
let privateKey: CryptoKey;
let publicJwk: JWK;
let jkt: string;

beforeEach(async () => {
  tdb = await withTestDb();
  ids = await seedMinimal(tdb);
  (globalThis as { __testDb?: unknown }).__testDb = tdb.db;
  resolveAgentToken.mockReset();

  const pair = await generateKeyPair('ES256', { extractable: true });
  privateKey = pair.privateKey as CryptoKey;
  const { kty, crv, x, y } = await exportJWK(pair.publicKey);
  publicJwk = { kty, crv, x, y } as JWK;
  jkt = await calculateJwkThumbprint(publicJwk, 'sha256');
});

afterEach(async () => {
  await tdb.close();
});

/**
 * A resolved session carrying the key thumbprint the token is bound to, or none.
 *
 * `jkt` is what lib/agentSession/descope.ts reads off the verified token's `cnf`, so
 * passing undefined here is the same as a token the authorization server did not bind.
 */
function signedIn(options: { scopes: string[]; jkt?: string }) {
  resolveAgentToken.mockImplementation(async (token: string) => {
    if (token !== 'good-token') return null;
    const [customer] = await tdb.db
      .select()
      .from(schema.customers)
      .where(eq(schema.customers.id, ids.alice));
    return {
      customer,
      agent: 'agent-under-test',
      email: customer.email,
      scopes: options.scopes,
      ...(options.jkt === undefined ? {} : { jkt: options.jkt }),
    };
  });
}

/** base64url(SHA-256(value)): how `ath` is written. */
async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Buffer.from(digest).toString('base64url');
}

/** A DPoP proof built exactly as @descope/poppy-agent builds one. */
async function proof(
  overrides: {
    htm?: string;
    htu?: string;
    ath?: string;
    iat?: number;
    jwk?: JWK;
    key?: CryptoKey;
    typ?: string;
    omitJti?: boolean;
  } = {},
): Promise<string> {
  const claims: Record<string, unknown> = {
    htm: overrides.htm ?? 'GET',
    htu: overrides.htu ?? `${ORIGIN}${PATH}`,
    ath: overrides.ath ?? (await sha256('good-token')),
  };
  if (!overrides.omitJti) claims.jti = 'proof-' + Math.random().toString(36).slice(2);
  return new SignJWT(claims)
    .setProtectedHeader({
      alg: 'ES256',
      typ: overrides.typ ?? 'dpop+jwt',
      jwk: overrides.jwk ?? publicJwk,
    })
    .setIssuedAt(overrides.iat ?? Math.floor(Date.now() / 1000))
    .sign(overrides.key ?? privateKey);
}

function request(init: { scheme?: string; token?: string; dpop?: string; path?: string } = {}) {
  const headers = new Headers();
  if (init.token) headers.set('authorization', `${init.scheme ?? 'DPoP'} ${init.token}`);
  if (init.dpop) headers.set('dpop', init.dpop);
  return new Request(`${ORIGIN}${init.path ?? PATH}`, { headers });
}

async function get(init: Parameters<typeof request>[0]) {
  const { GET } = await import('@/app/api/agent/v1/orders/route');
  return GET(request(init), undefined);
}

describe('a token bound to a key', () => {
  it('is accepted when it arrives as DPoP with a good proof', async () => {
    signedIn({ scopes: ['orders:read'], jkt });
    const res = await get({ token: 'good-token', dpop: await proof() });
    expect(res.status).toBe(200);
  });

  it('is refused when it arrives as Bearer, because that would unbind it', async () => {
    signedIn({ scopes: ['orders:read'], jkt });
    const res = await get({ scheme: 'Bearer', token: 'good-token', dpop: await proof() });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: 'invalid_dpop_proof' });
  });

  it('is refused when no proof is sent at all', async () => {
    signedIn({ scopes: ['orders:read'], jkt });
    const res = await get({ token: 'good-token' });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('invalid_dpop_proof');
    expect(body.error_description).toContain('no DPoP proof');
  });

  it('is refused when the proof is signed by some other key', async () => {
    signedIn({ scopes: ['orders:read'], jkt });
    const other = await generateKeyPair('ES256', { extractable: true });
    const { kty, crv, x, y } = await exportJWK(other.publicKey);
    const res = await get({
      token: 'good-token',
      dpop: await proof({ key: other.privateKey as CryptoKey, jwk: { kty, crv, x, y } as JWK }),
    });
    expect(res.status).toBe(401);
    expect((await res.json()).error_description).toContain('different key');
  });

  it('is refused when the proof names another URL', async () => {
    signedIn({ scopes: ['orders:read'], jkt });
    const res = await get({
      token: 'good-token',
      dpop: await proof({ htu: `${ORIGIN}/api/agent/v1/cart` }),
    });
    expect(res.status).toBe(401);
    expect((await res.json()).error_description).toContain('/api/agent/v1/cart');
  });

  it('is refused when the proof names another method', async () => {
    signedIn({ scopes: ['orders:read'], jkt });
    const res = await get({ token: 'good-token', dpop: await proof({ htm: 'POST' }) });
    expect(res.status).toBe(401);
    expect((await res.json()).error_description).toContain('POST');
  });

  it('is refused when the proof was made for a different access token', async () => {
    signedIn({ scopes: ['orders:read'], jkt });
    const res = await get({
      token: 'good-token',
      dpop: await proof({ ath: await sha256('some-other-token') }),
    });
    expect(res.status).toBe(401);
    expect((await res.json()).error_description).toContain('access token');
  });

  it('is refused when the proof is older than the window', async () => {
    signedIn({ scopes: ['orders:read'], jkt });
    const res = await get({
      token: 'good-token',
      dpop: await proof({ iat: Math.floor(Date.now() / 1000) - 3600 }),
    });
    expect(res.status).toBe(401);
    expect((await res.json()).error_description).toContain('just now');
  });

  it('is refused when the proof is not typed dpop+jwt', async () => {
    signedIn({ scopes: ['orders:read'], jkt });
    const res = await get({ token: 'good-token', dpop: await proof({ typ: 'JWT' }) });
    expect(res.status).toBe(401);
    expect((await res.json()).error_description).toContain('dpop+jwt');
  });

  it('is refused when the proof carries no jti', async () => {
    signedIn({ scopes: ['orders:read'], jkt });
    const res = await get({ token: 'good-token', dpop: await proof({ omitJti: true }) });
    expect(res.status).toBe(401);
    expect((await res.json()).error_description).toContain('jti');
  });

  it('answers with a DPoP challenge naming the algorithms it will verify', async () => {
    signedIn({ scopes: ['orders:read'], jkt });
    const res = await get({ token: 'good-token' });
    const header = res.headers.get('www-authenticate') ?? '';
    expect(header.startsWith('DPoP ')).toBe(true);
    expect(header).toContain('error="invalid_dpop_proof"');
    expect(header).toContain('ES256');
    // Still names where the metadata is, so a client that arrived with nothing can start.
    expect(header).toContain('resource_metadata=');
  });
});

describe('a token the authorization server did not bind', () => {
  it('still works as a plain bearer token', async () => {
    signedIn({ scopes: ['orders:read'] });
    const res = await get({ scheme: 'Bearer', token: 'good-token' });
    expect(res.status).toBe(200);
  });

  it('is refused when sent as DPoP, since there is nothing to prove', async () => {
    signedIn({ scopes: ['orders:read'] });
    const res = await get({ token: 'good-token', dpop: await proof() });
    expect(res.status).toBe(401);
    expect((await res.json()).error_description).toContain('not bound to a key');
  });
});

describe('what the refusal says', () => {
  it('names the scheme the agent used when the token itself is rejected', async () => {
    signedIn({ scopes: ['orders:read'], jkt });
    const res = await get({ token: 'some-other-token', dpop: await proof() });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')?.startsWith('DPoP ')).toBe(true);
  });

  it('is unchanged for a request that carries no Authorization header', async () => {
    signedIn({ scopes: ['orders:read'], jkt });
    const res = await get({});
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')?.startsWith('Bearer ')).toBe(true);
    expect((await res.json()).error).toBe('unauthorized');
  });
});
