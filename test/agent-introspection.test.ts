import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { generateKeyPair, exportJWK, SignJWT, type CryptoKey as JoseKey } from 'jose';
import { withTestDb, seedMinimal, type TestDb } from './harness';

let tdb: TestDb;

vi.mock('@/db/client', () => ({
  get db() {
    return (globalThis as { __testDb?: unknown }).__testDb;
  },
}));

const DISCOVERY = 'https://api.descope.test/v1/apps/P1/.well-known/openid-configuration';
const ISSUER = 'https://api.descope.test/v1/apps/P1';
const JWKS = 'https://api.descope.test/P1/.well-known/jwks.json';
const INTROSPECT = 'https://api.descope.test/oauth2/v1/apps/introspect';

let signingKey: JoseKey;
let otherKey: JoseKey;
const realFetch = globalThis.fetch;

/** Every introspection request the code made, in order. */
let calls: { authorization: string | null; body: string }[];
/** What the stubbed endpoint answers with. */
let introspection: { status: number; body?: unknown };

beforeEach(async () => {
  tdb = await withTestDb();
  await seedMinimal(tdb);
  (globalThis as { __testDb?: unknown }).__testDb = tdb.db;

  process.env.DESCOPE_DISCOVERY_URL = DISCOVERY;
  process.env.DESCOPE_BASE_URL = 'https://api.descope.test';
  process.env.DESCOPE_INTROSPECT_CLIENT_ID = 'northbound-rs';
  process.env.DESCOPE_INTROSPECT_CLIENT_SECRET = 'rs-secret';

  calls = [];
  introspection = { status: 200, body: { active: true } };

  const pair = await generateKeyPair('RS256');
  signingKey = pair.privateKey;
  otherKey = (await generateKeyPair('RS256')).privateKey;
  const publicJwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === DISCOVERY) return Response.json({ issuer: ISSUER, jwks_uri: JWKS });
    if (url === JWKS) return Response.json({ keys: [publicJwk] });
    if (url === INTROSPECT) {
      const headers = new Headers(init?.headers);
      calls.push({ authorization: headers.get('authorization'), body: String(init?.body ?? '') });
      if (introspection.status !== 200) return new Response(null, { status: introspection.status });
      return Response.json(introspection.body);
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;

  const { resetAgentSessionCache } = await import('@/lib/agentSession/descope');
  resetAgentSessionCache();
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  delete process.env.DESCOPE_DISCOVERY_URL;
  delete process.env.DESCOPE_BASE_URL;
  delete process.env.DESCOPE_INTROSPECT_CLIENT_ID;
  delete process.env.DESCOPE_INTROSPECT_CLIENT_SECRET;
  await tdb.close();
});

function token(opts: { key?: JoseKey; exp?: string | number } = {}) {
  return new SignJWT({ email: 'alice@example.com', act: { sub: 'agt_abc' }, scope: 'orders:read' })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(ISSUER)
    .setSubject('U123')
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? '10m')
    .sign(opts.key ?? signingKey);
}

describe('checking the session is still signed in', () => {
  it('accepts a token Descope still reports as active', async () => {
    const { resolveAgentToken } = await import('@/lib/agentSession/descope');

    const session = await resolveAgentToken(await token());

    expect(session?.customer.id).toBe(82731);
    expect(calls).toHaveLength(1);
  });

  // The headline: a signature that still verifies is no longer enough on its own.
  it('rejects a token whose session Descope has signed out', async () => {
    introspection = { status: 200, body: { active: false } };
    const { resolveAgentToken } = await import('@/lib/agentSession/descope');

    expect(await resolveAgentToken(await token())).toBeNull();
  });

  it('sends the token to the Inbound App route, authenticated as the resource server', async () => {
    const { resolveAgentToken } = await import('@/lib/agentSession/descope');
    const jwt = await token();

    await resolveAgentToken(jwt);

    const expected = Buffer.from('northbound-rs:rs-secret').toString('base64');
    expect(calls[0].authorization).toBe(`Basic ${expected}`);

    const sent = new URLSearchParams(calls[0].body);
    expect(sent.get('token')).toBe(jwt);
    expect(sent.get('token_type_hint')).toBe('access_token');
  });

  // Fails closed, deliberately. Documented as a trade in descope.ts: an outage at
  // Descope signs agents out rather than letting a revoked token through.
  it('rejects the token when Descope cannot be reached', async () => {
    introspection = { status: 503 };
    const { resolveAgentToken } = await import('@/lib/agentSession/descope');

    expect(await resolveAgentToken(await token())).toBeNull();
  });

  it('treats a response without an explicit active:true as not signed in', async () => {
    introspection = { status: 200, body: {} };
    const { resolveAgentToken } = await import('@/lib/agentSession/descope');

    expect(await resolveAgentToken(await token())).toBeNull();
  });

  // Cheap local checks first. A forged token must not become a way to make the store
  // send traffic to Descope on demand.
  it('never asks Descope about a token that fails verification locally', async () => {
    const { resolveAgentToken } = await import('@/lib/agentSession/descope');

    expect(await resolveAgentToken(await token({ key: otherKey }))).toBeNull();
    expect(await resolveAgentToken(await token({ exp: '-1m' }))).toBeNull();
    expect(await resolveAgentToken('not-a-token')).toBeNull();

    expect(calls).toEqual([]);
  });
});

describe('without introspection credentials', () => {
  beforeEach(() => {
    delete process.env.DESCOPE_INTROSPECT_CLIENT_ID;
    delete process.env.DESCOPE_INTROSPECT_CLIENT_SECRET;
  });

  // The storefront still runs on a discovery URL alone, exactly as before.
  it('verifies offline and calls nobody', async () => {
    const { resolveAgentToken } = await import('@/lib/agentSession/descope');

    expect((await resolveAgentToken(await token()))?.customer.id).toBe(82731);
    expect(calls).toEqual([]);
  });

  it('cannot tell that a session was signed out', async () => {
    introspection = { status: 200, body: { active: false } };
    const { resolveAgentToken } = await import('@/lib/agentSession/descope');

    // Accepted anyway: this is the cost of the offline-only branch, and the reason
    // Poppy pairs it with much shorter token lifetimes.
    expect(await resolveAgentToken(await token())).not.toBeNull();
  });
});
