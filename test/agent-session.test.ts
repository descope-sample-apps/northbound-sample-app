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
  return new SignJWT({ email: 'alice@example.com', act: { sub: 'agt_abc' }, scope: 'openid orders:read', ...claims })
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

  // The reason is what a deployment can choose to show the agent (AGENT_DEBUG_REFUSALS),
  // so it has to name the guard rather than say "invalid". These are the two refusals
  // that look identical from outside and are the usual cause of an agent that signs in,
  // is refused, and signs in again: an account that isn't here, and a scope that wasn't
  // approved. A reason that didn't tell them apart would leave the loop unexplained.
  it('says which guard turned a token away', async () => {
    const { inspectAgentToken } = await import('@/lib/agentSession/descope');

    const unknown = await inspectAgentToken(await token({ email: 'nobody@example.com' }));
    expect(unknown.session).toBeNull();
    expect(unknown.reason).toContain('no Northbound customer with that email');

    const unscoped = await inspectAgentToken(await token({ scope: 'openid email' }));
    expect(unscoped.session).toBeNull();
    expect(unscoped.reason).toContain('orders:read');
  });

  it('carries no reason when the token is good', async () => {
    const { inspectAgentToken } = await import('@/lib/agentSession/descope');

    const good = await inspectAgentToken(await token({ email: 'ALICE@example.com' }));

    expect(good.session?.customer.id).toBe(82731);
    expect(good.reason).toBeUndefined();
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

describe('step-up for agent purchases', () => {
  const STEP_UP_SECRET = 'step-up-secret';

  beforeEach(() => {
    process.env.FRONT_DOOR_URL = 'https://agents.test';
    process.env.STEP_UP_SECRET = STEP_UP_SECRET;
  });
  afterEach(() => {
    delete process.env.FRONT_DOOR_URL;
    delete process.env.STEP_UP_SECRET;
  });

  /** Puts one of the product in Alice's cart and returns the checkout form for it. */
  async function checkoutForm(slug: string) {
    const schema = await import('@/db/schema');
    const { eq } = await import('drizzle-orm');
    const { addToCart, getCart } = await import('@/lib/services/cart');
    const { getProductBySlug } = await import('@/lib/services/catalog');
    await addToCart({ customerId: 82731 }, (await getProductBySlug(slug)).id, 1);
    const [address] = await tdb.db.select().from(schema.addresses).where(eq(schema.addresses.customerId, 82731));
    const [card] = await tdb.db.select().from(schema.paymentMethods).where(eq(schema.paymentMethods.customerId, 82731));
    const form = new FormData();
    form.set('addressId', String(address.id));
    form.set('paymentMethodId', String(card.id));
    form.set('expectedTotalCents', String((await getCart({ customerId: 82731 })).totalCents));
    return { form, totalCents: (await getCart({ customerId: 82731 })).totalCents };
  }

  async function placeOrder(form: FormData): Promise<string> {
    const { placeOrderAction } = await import('@/app/checkout/actions');
    try {
      await placeOrderAction({}, form);
    } catch (error) {
      return String((error as Error).message);
    }
    return 'no redirect';
  }

  it('sends a read-only agent to the front door with a signed description of the order', async () => {
    jar.set('DS', await token({ scope: 'openid orders:read' }));
    const { form, totalCents } = await checkoutForm('cascade-45l');
    const outcome = await placeOrder(form);
    expect(outcome).toMatch(/^redirect:https:\/\/agents\.test\/step-up\?/);

    const url = new URL(outcome.slice('redirect:'.length));
    expect(url.searchParams.get('return_to')).toBe('https://shop.test/checkout');
    const [body, signature] = url.searchParams.get('request')!.split('.');
    const { createHmac } = await import('node:crypto');
    expect(signature).toBe(createHmac('sha256', STEP_UP_SECRET).update(body).digest('base64url'));
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    expect(payload.email).toBe('alice@example.com');
    expect(payload.amount).toBe(`$${(totalCents / 100).toFixed(2)}`);
    expect(payload.exp).toBeGreaterThan(Date.now() / 1000);

    const { listOrders } = await import('@/lib/services/orders');
    expect(await listOrders(82731)).toHaveLength(0);
  });

  it('lets an agent whose token has orders:write place the order', async () => {
    jar.set('DS', await token({ scope: 'openid orders:write' }));
    const { form } = await checkoutForm('cascade-45l');
    expect(await placeOrder(form)).toMatch(/^redirect:\/checkout\/confirmation\//);

    const { listOrders } = await import('@/lib/services/orders');
    expect((await listOrders(82731))[0].placedByAgent).toBe('agt_abc');
  });

  it("doesn't change checkout for the customer", async () => {
    const { createSession } = await import('@/lib/auth/session');
    jar.set('nb_session', await createSession(82731));
    const { form } = await checkoutForm('cascade-45l');
    expect(await placeOrder(form)).toMatch(/^redirect:\/checkout\/confirmation\//);

    const { listOrders } = await import('@/lib/services/orders');
    expect((await listOrders(82731))[0].placedByAgent).toBeNull();
  });
});

describe('creating an account on first approval (DEMO_AUTO_SIGNUP)', () => {
  afterEach(() => { delete process.env.DEMO_AUTO_SIGNUP; });

  it('is off by default: an unknown email is not signed in', async () => {
    const { resolveAgentToken } = await import('@/lib/agentSession/descope');
    expect(await resolveAgentToken(await token({ email: 'new.reader@example.org' }))).toBeNull();
  });

  it('creates the customer with an address and a test card, once', async () => {
    process.env.DEMO_AUTO_SIGNUP = 'true';
    const { resolveAgentToken } = await import('@/lib/agentSession/descope');
    const first = await resolveAgentToken(await token({ email: 'New.Reader@example.org', name: 'Riley Reader' }));
    expect(first?.customer.email).toBe('new.reader@example.org');
    expect(first?.customer.name).toBe('Riley Reader');
    expect(first?.customer.emailVerified).toBe(true);

    const { listAddresses } = await import('@/lib/services/addresses');
    const { listPaymentMethods } = await import('@/lib/services/paymentMethods');
    expect((await listAddresses(first!.customer.id)).length).toBe(1);
    expect((await listPaymentMethods(first!.customer.id))[0].last4).toBe('4242');

    const again = await resolveAgentToken(await token({ email: 'new.reader@example.org' }));
    expect(again?.customer.id).toBe(first!.customer.id);
    expect((await listAddresses(first!.customer.id)).length).toBe(1);
  });
});

describe('the resource the token is for (DESCOPE_AUDIENCE)', () => {
  const RESOURCE = 'https://northbound.camp/agent_resource';
  afterEach(() => { delete process.env.DESCOPE_AUDIENCE; });

  it('accepts a token issued for the resource', async () => {
    process.env.DESCOPE_AUDIENCE = RESOURCE;
    const { resolveAgentToken } = await import('@/lib/agentSession/descope');
    expect((await resolveAgentToken(await token({ aud: RESOURCE })))?.customer.id).toBe(82731);
    expect((await resolveAgentToken(await token({ aud: ['other', RESOURCE] })))?.customer.id).toBe(82731);
  });

  it('rejects a token for another resource, or with no audience', async () => {
    process.env.DESCOPE_AUDIENCE = RESOURCE;
    const { resolveAgentToken } = await import('@/lib/agentSession/descope');
    expect(await resolveAgentToken(await token({ aud: 'https://other.example/api' }))).toBeNull();
    expect(await resolveAgentToken(await token())).toBeNull();
  });

  // THE MIGRATION WINDOW. The audience is minted by the front door and checked here, in
  // two separately deployed places, so moving a single value breaks whichever deploys
  // second for as long as the live tokens last. A list is what makes the move orderable:
  // accept both, move the front door, drop the old one.
  const API = 'https://northbound.camp/api/agent/v1';

  it('accepts either identifier while both are listed', async () => {
    process.env.DESCOPE_AUDIENCE = `${RESOURCE},${API}`;
    const { resolveAgentToken } = await import('@/lib/agentSession/descope');

    expect((await resolveAgentToken(await token({ aud: RESOURCE })))?.customer.id).toBe(82731);
    expect((await resolveAgentToken(await token({ aud: API })))?.customer.id).toBe(82731);
  });

  // A list widens the check, it never drops it: anything not on the list is still refused.
  it('still refuses a resource that is on neither', async () => {
    process.env.DESCOPE_AUDIENCE = `${RESOURCE},${API}`;
    const { resolveAgentToken } = await import('@/lib/agentSession/descope');

    expect(await resolveAgentToken(await token({ aud: 'https://other.example/api' }))).toBeNull();
  });

  it('ignores spacing and stray commas rather than demanding a resource named ""', async () => {
    process.env.DESCOPE_AUDIENCE = `  ${RESOURCE} , , ${API}, `;
    const { resolveAgentToken } = await import('@/lib/agentSession/descope');

    expect((await resolveAgentToken(await token({ aud: API })))?.customer.id).toBe(82731);
  });

  // Unset still means no audience check at all, which is what keeps the store runnable
  // with nothing but a discovery URL.
  it('checks nothing when the setting is empty', async () => {
    process.env.DESCOPE_AUDIENCE = '  ';
    const { resolveAgentToken } = await import('@/lib/agentSession/descope');

    expect((await resolveAgentToken(await token({ aud: 'https://anything.example' })))?.customer.id)
      .toBe(82731);
  });
});

describe('the scopes an agent needs to sign in', () => {
  it('accepts orders:read or orders:write', async () => {
    const { resolveAgentToken } = await import('@/lib/agentSession/descope');
    expect((await resolveAgentToken(await token({ scope: 'openid orders:read' })))?.customer.id).toBe(82731);
    expect((await resolveAgentToken(await token({ scope: 'openid orders:write' })))?.customer.id).toBe(82731);
  });

  it('rejects a token with neither, even if it is otherwise valid', async () => {
    const { resolveAgentToken } = await import('@/lib/agentSession/descope');
    expect(await resolveAgentToken(await token({ scope: 'openid email' }))).toBeNull();
    expect(await resolveAgentToken(await token({ scope: undefined }))).toBeNull();
    expect(await resolveAgentToken(await token({ scope: 'orders:readonly' }))).toBeNull();
  });
});
