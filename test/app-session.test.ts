import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { generateKeyPair, exportJWK, SignJWT, type CryptoKey as JoseKey } from 'jose';
import { withTestDb, seedMinimal, type TestDb } from './harness';

let tdb: TestDb;

vi.mock('@/db/client', () => ({
  get db() {
    return (globalThis as { __testDb?: unknown }).__testDb;
  },
}));

const BASE = 'https://api.descope.test';
const ISSUER = `${BASE}/P1`;
const JWKS = `${BASE}/P1/.well-known/jwks.json`;

let signingKey: JoseKey;
let otherKey: JoseKey;
const realFetch = globalThis.fetch;

beforeEach(async () => {
  tdb = await withTestDb();
  await seedMinimal(tdb);
  (globalThis as { __testDb?: unknown }).__testDb = tdb.db;
  process.env.DESCOPE_BASE_URL = BASE;
  process.env.DESCOPE_PROJECT_ID = 'P1';

  const pair = await generateKeyPair('RS256');
  signingKey = pair.privateKey;
  otherKey = (await generateKeyPair('RS256')).privateKey;
  const publicJwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === JWKS) return Response.json({ keys: [publicJwk] });
    return new Response(null, { status: 404 });
  }) as typeof fetch;

  const { resetAppSessionCache } = await import('@/lib/appSession/descope');
  resetAppSessionCache();
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  delete process.env.DESCOPE_BASE_URL;
  delete process.env.DESCOPE_PROJECT_ID;
  delete process.env.DESCOPE_SESSION_ISSUERS;
  delete process.env.DEMO_AUTO_SIGNUP;
  await tdb.close();
});

/** A customer's own Descope session token: the project's issuer, an email, no act. */
function sessionToken(
  claims: Record<string, unknown> = {},
  opts: { key?: JoseKey; issuer?: string; exp?: string | number } = {},
) {
  return new SignJWT({ email: 'alice@example.com', ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(opts.issuer ?? ISSUER)
    .setSubject('U1')
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? '10m')
    .sign(opts.key ?? signingKey);
}

describe("resolving a customer's own session token", () => {
  it("accepts the customer's own session token", async () => {
    const { resolveCustomerToken } = await import('@/lib/appSession/descope');
    const session = await resolveCustomerToken(await sessionToken());
    expect(session?.customer.email).toBe('alice@example.com');
    expect(session?.email).toBe('alice@example.com');
  });

  it('matches email case-insensitively', async () => {
    const { resolveCustomerToken } = await import('@/lib/appSession/descope');
    const session = await resolveCustomerToken(await sessionToken({ email: 'Alice@Example.com' }));
    expect(session?.customer.email).toBe('alice@example.com');
  });

  it('accepts the bare project ID as issuer by default', async () => {
    const { resolveCustomerToken } = await import('@/lib/appSession/descope');
    expect(await resolveCustomerToken(await sessionToken({}, { issuer: 'P1' }))).not.toBeNull();
  });

  it('rejects agent tokens', async () => {
    const { resolveCustomerToken } = await import('@/lib/appSession/descope');
    expect(await resolveCustomerToken(await sessionToken({ act: { sub: 'agent-1' }, scope: 'orders:write' }))).toBeNull();
    process.env.DESCOPE_SESSION_ISSUERS = `${ISSUER},${BASE}/v1/apps/P1`;
    expect(await resolveCustomerToken(await sessionToken({}, { issuer: `${BASE}/v1/apps/P1` }))).toBeNull();
  });

  it('rejects a bad signature, wrong issuer, expiry, or no email', async () => {
    const { resolveCustomerToken } = await import('@/lib/appSession/descope');
    expect(await resolveCustomerToken(await sessionToken({}, { key: otherKey }))).toBeNull();
    expect(await resolveCustomerToken(await sessionToken({}, { issuer: 'https://evil.test' }))).toBeNull();
    expect(await resolveCustomerToken(await sessionToken({}, { exp: Math.floor(Date.now() / 1000) - 60 }))).toBeNull();
    expect(await resolveCustomerToken(await sessionToken({ email: undefined }))).toBeNull();
    expect(await resolveCustomerToken('not-a-jwt')).toBeNull();
  });

  it('creates the customer only with DEMO_AUTO_SIGNUP', async () => {
    const { resolveCustomerToken } = await import('@/lib/appSession/descope');
    expect(await resolveCustomerToken(await sessionToken({ email: 'new@example.com' }))).toBeNull();
    process.env.DEMO_AUTO_SIGNUP = 'true';
    const session = await resolveCustomerToken(await sessionToken({ email: 'new@example.com' }));
    expect(session?.customer.email).toBe('new@example.com');
  });

  it('is off when DESCOPE_PROJECT_ID is unset', async () => {
    const { resolveCustomerToken } = await import('@/lib/appSession/descope');
    delete process.env.DESCOPE_PROJECT_ID;
    expect(await resolveCustomerToken(await sessionToken())).toBeNull();
  });
});
