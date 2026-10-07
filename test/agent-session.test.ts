import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { generateKeyPair, exportJWK, SignJWT, type CryptoKey as JoseKey } from 'jose';
import { withTestDb, seedMinimal, type TestDb } from './harness';

let tdb: TestDb;
let jar: Map<string, string>;

vi.mock('@/db/client', () => ({
  get db() {
    return (globalThis as { __testDb?: unknown }).__testDb;
  },
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => { jar.set(name, value); },
    delete: (name: string) => { jar.delete(name); },
  }),
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); } }));

const DISCOVERY = 'https://api.descope.test/v1/apps/P1/.well-known/openid-configuration';
const ISSUER = 'https://api.descope.test/v1/apps/P1';
const JWKS = 'https://api.descope.test/P1/.well-known/jwks.json';

let signingKey: JoseKey;
let otherKey: JoseKey;
const realFetch = globalThis.fetch;

beforeEach(async () => {
  tdb = await withTestDb();
  await seedMinimal(tdb);
  (globalThis as { __testDb?: unknown }).__testDb = tdb.db;
  jar = new Map();
  process.env.DESCOPE_DISCOVERY_URL = DISCOVERY;

  const pair = await generateKeyPair('RS256');
  signingKey = pair.privateKey;
  otherKey = (await generateKeyPair('RS256')).privateKey;
  const publicJwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === DISCOVERY) return Response.json({ issuer: ISSUER, jwks_uri: JWKS });
    if (url === JWKS) return Response.json({ keys: [publicJwk] });
    return new Response(null, { status: 404 });
  }) as typeof fetch;

  const { resetAgentSessionCache } = await import('@/lib/agentSession/descope');
  resetAgentSessionCache();
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  delete process.env.DESCOPE_DISCOVERY_URL;
  await tdb.close();
});

function token(claims: Record<string, unknown> = {}, opts: { key?: JoseKey; issuer?: string; exp?: string | number } = {}) {
  return new SignJWT({ email: 'alice@example.com', act: { sub: 'agt_abc' }, ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(opts.issuer ?? ISSUER)
    .setSubject('U123')
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? '10m')
    .sign(opts.key ?? signingKey);
}

describe('resolving a Descope agent token', () => {
  it('maps a valid token to the customer with the same email, and records the agent from act.sub', async () => {
    const { resolveAgentToken } = await import('@/lib/agentSession/descope');
    const session = await resolveAgentToken(await token({ email: 'ALICE@example.com' }));
    expect(session?.customer.id).toBe(82731);
    expect(session?.agent).toBe('agt_abc');
  });

  it('requires both email and act', async () => {
    const { resolveAgentToken } = await import('@/lib/agentSession/descope');
    expect(await resolveAgentToken(await token({ email: undefined }))).toBeNull();
    expect(await resolveAgentToken(await token({ act: undefined }))).toBeNull();
  });

  it('fails closed on a bad signature, the wrong issuer, expiry, or an unknown customer', async () => {
    const { resolveAgentToken } = await import('@/lib/agentSession/descope');
    expect(await resolveAgentToken(await token({}, { key: otherKey }))).toBeNull();
    expect(await resolveAgentToken(await token({}, { issuer: 'https://evil.test' }))).toBeNull();
    expect(await resolveAgentToken(await token({}, { exp: Math.floor(Date.now() / 1000) - 60 }))).toBeNull();
    expect(await resolveAgentToken(await token({ email: 'nobody@example.com' }))).toBeNull();
    expect(await resolveAgentToken('not-a-jwt')).toBeNull();
  });

  it('is off when DESCOPE_DISCOVERY_URL is unset', async () => {
    const { resolveAgentToken } = await import('@/lib/agentSession/descope');
    delete process.env.DESCOPE_DISCOVERY_URL;
    expect(await resolveAgentToken(await token())).toBeNull();
  });
});

describe('the storefront with an agent cookie', () => {
  it('signs the agent in as the customer', async () => {
    jar.set('DS', await token());
    const { getCurrentCustomer, getAgentSession } = await import('@/lib/auth/session-cookie');
    expect((await getCurrentCustomer())?.id).toBe(82731);
    expect((await getAgentSession())?.agent).toBe('agt_abc');
  });

  it("treats a person's own session as theirs, even with an agent cookie present", async () => {
    const { createSession } = await import('@/lib/auth/session');
    jar.set('nb_session', await createSession(82731));
    jar.set('DS', await token());
    const { getAgentSession, getCurrentCustomer } = await import('@/lib/auth/session-cookie');
    expect((await getCurrentCustomer())?.id).toBe(82731);
    expect(await getAgentSession()).toBeNull();
  });

  it('signing out clears the agent cookie', async () => {
    jar.set('DS', await token());
    const { clearSessionCookie } = await import('@/lib/auth/session-cookie');
    await clearSessionCookie();
    expect(jar.has('DS')).toBe(false);
  });
});
