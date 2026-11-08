import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { generateKeyPair, exportJWK, SignJWT, type CryptoKey as JoseKey } from 'jose';
import { eq } from 'drizzle-orm';
import { withTestDb, seedMinimal, type TestDb } from './harness';
import { addresses, customers } from '@/db/schema';

let tdb: TestDb;
let jar: Map<string, string>;

vi.mock('@/db/client', () => ({
  get db() {
    return (globalThis as { __testDb?: unknown }).__testDb;
  },
}));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ origin: 'https://shop.test' }),
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
const ALICE = 82731;

let signingKey: JoseKey;
const realFetch = globalThis.fetch;

beforeEach(async () => {
  tdb = await withTestDb();
  await seedMinimal(tdb);
  (globalThis as { __testDb?: unknown }).__testDb = tdb.db;
  jar = new Map();
  process.env.DESCOPE_DISCOVERY_URL = DISCOVERY;

  const pair = await generateKeyPair('RS256');
  signingKey = pair.privateKey;
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
  vi.resetModules();
  await tdb.close();
});

/** Signs an agent in as Alice, the way the Agent Edge front door would. */
async function signInAgent(scope = 'orders:read orders:write') {
  const token = await new SignJWT({ email: 'alice@example.com', act: { sub: 'agt_abc' }, scope })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(ISSUER)
    .setSubject('U123')
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(signingKey);
  jar.set('DS', token);
}

async function signInHuman() {
  const { createSession } = await import('@/lib/auth/session');
  jar.set('nb_session', await createSession(ALICE));
}

describe('an assistant cannot change account data', () => {
  it('refuses to rename the profile, and the name does not change', async () => {
    await signInAgent();
    const { updateProfileAction } = await import('@/app/account/actions');

    const form = new FormData();
    form.set('name', 'Renamed By Assistant');
    const result = await updateProfileAction({}, form);

    expect(result.error).toMatch(/cannot change your account details/i);
    expect(result.saved).toBeUndefined();

    const [alice] = await tdb.db.select().from(customers).where(eq(customers.id, ALICE));
    expect(alice.name).toBe('Alice Chen');
  });

  // The one that matters most: an assistant that could edit this could redirect
  // every future order to an address the customer never chose.
  it('refuses to delete a saved address, and the address survives', async () => {
    await signInAgent();
    const [address] = await tdb.db.select().from(addresses).where(eq(addresses.customerId, ALICE));
    const { deleteAddressAction } = await import('@/app/account/actions');

    const form = new FormData();
    form.set('id', String(address.id));
    const result = await deleteAddressAction({}, form);

    expect(result.error).toMatch(/cannot change your account details/i);
    expect(await tdb.db.select().from(addresses).where(eq(addresses.id, address.id))).toHaveLength(1);
  });

  it('refuses to add a payment method', async () => {
    await signInAgent();
    const { addPaymentMethodAction } = await import('@/app/account/actions');

    const form = new FormData();
    for (const [k, v] of Object.entries({
      brand: 'visa', last4: '1111', expMonth: '6', expYear: '2031', holderName: 'Agent',
    })) form.set(k, v);

    expect((await addPaymentMethodAction({}, form)).error).toMatch(/cannot change/i);
  });

  // Full scopes make no difference. Northbound issues no scope for account data,
  // so orders:write buys an order, not an address book.
  it('refuses even an assistant holding every scope the store issues', async () => {
    await signInAgent('orders:read orders:write');
    const { updateProfileAction } = await import('@/app/account/actions');

    const form = new FormData();
    form.set('name', 'Still Refused');
    expect((await updateProfileAction({}, form)).error).toBeTruthy();
  });
});

describe('a person is unaffected', () => {
  it('renames the profile when the customer is signed in themselves', async () => {
    await signInHuman();
    const { updateProfileAction } = await import('@/app/account/actions');

    const form = new FormData();
    form.set('name', 'Alice Renamed');
    expect(await updateProfileAction({}, form)).toEqual({ saved: true });

    const [alice] = await tdb.db.select().from(customers).where(eq(customers.id, ALICE));
    expect(alice.name).toBe('Alice Renamed');
  });

  // A person's own session wins over an agent cookie in the same browser, so the
  // gate must not fire on a customer who happens to have one.
  it('lets a signed-in customer through even with an agent cookie present', async () => {
    await signInHuman();
    await signInAgent();
    const { updateProfileAction } = await import('@/app/account/actions');

    const form = new FormData();
    form.set('name', 'Person Wins');
    expect((await updateProfileAction({}, form)).saved).toBe(true);
  });
});

describe('the gate cannot be bypassed by adding an action', () => {
  // Seven actions today, all funnelled through one run() helper. A new action that
  // writes account data without it would be gated by nobody, and would look exactly
  // like the six that are.
  it('routes every exported account action through the gated helper', () => {
    const source = readFileSync('app/account/actions.ts', 'utf8');

    const exported = [...source.matchAll(/export async function (\w+Action)\(/g)].map((m) => m[1]);
    expect(exported.length).toBeGreaterThanOrEqual(7);

    const bodies = source.split(/export async function /).slice(1);
    for (const body of bodies) {
      const name = body.slice(0, body.indexOf('('));
      expect(body, `${name} should delegate to run()`).toMatch(/\breturn run\(/);
    }

    expect(source).toContain('refuseAgentAccountChange');
  });
});
