import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { generateKeyPair, exportJWK, SignJWT, type CryptoKey as JoseKey } from 'jose';
import { eq } from 'drizzle-orm';
import { withTestDb, seedMinimal, type TestDb } from './harness';
import { addresses, orders, paymentMethods } from '@/db/schema';

let tdb: TestDb;

vi.mock('@/db/client', () => ({
  get db() {
    return (globalThis as { __testDb?: unknown }).__testDb;
  },
}));

const ALICE = 82731;
const CAROL = 44102;
const BASE = 'https://api.descope.test';
const ISSUER = `${BASE}/P1`;
const JWKS = `${BASE}/P1/.well-known/jwks.json`;
const ORIGIN = 'https://shop.test';

let signingKey: JoseKey;
const realFetch = globalThis.fetch;

beforeEach(async () => {
  tdb = await withTestDb();
  await seedMinimal(tdb);
  (globalThis as { __testDb?: unknown }).__testDb = tdb.db;
  process.env.DESCOPE_BASE_URL = BASE;
  process.env.DESCOPE_PROJECT_ID = 'P1';

  const pair = await generateKeyPair('RS256');
  signingKey = pair.privateKey;
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
  await tdb.close();
});

function token(claims: Record<string, unknown> = {}) {
  return new SignJWT({ email: 'alice@example.com', ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(ISSUER)
    .setSubject('U1')
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(signingKey);
}

async function get(path: string, bearer?: string): Promise<Request> {
  return new Request(`${ORIGIN}/api/app/v1${path}`, {
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
  });
}

const noContext = { params: Promise.resolve({}) };
const orderContext = (orderNumber: string) => ({ params: Promise.resolve({ orderNumber }) });

async function seedOrders() {
  const now = new Date();
  const [address] = await tdb.db.select().from(addresses).where(eq(addresses.customerId, ALICE));
  const [card] = await tdb.db.select().from(paymentMethods).where(eq(paymentMethods.customerId, ALICE));
  const order = (customerId: number, orderNumber: number, placedByAgent: string | null, placedAt: Date) => ({
    customerId, orderNumber, status: 'placed' as const,
    subtotalCents: 65000, shippingCents: 0, taxCents: 0, totalCents: 65000,
    shippingAddressId: address.id, paymentMethodId: card.id, placedAt, placedByAgent,
  });
  await tdb.db.insert(orders).values([
    order(ALICE, 1001, null, new Date(now.getTime() - 60_000)),
    order(ALICE, 1002, 'agent-1', now),
    order(CAROL, 2001, null, now),
  ]);
}

describe('the customer app API', () => {
  it("serves the signed-in customer's orders, newest first, with placed_by_agent", async () => {
    await seedOrders();
    const { GET } = await import('@/app/api/app/v1/orders/route');
    const res = await GET(await get('/orders', await token()), noContext);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.orders.map((o: { order_number: number }) => o.order_number)).toEqual([1002, 1001]);
    expect(body.orders[0].placed_by_agent).toBe('agent-1');
    expect(body.orders[1].placed_by_agent).toBeNull();
  });

  it('serves one order', async () => {
    await seedOrders();
    const { GET } = await import('@/app/api/app/v1/orders/[orderNumber]/route');
    const res = await GET(await get('/orders/1002', await token()), orderContext('1002'));
    expect(res.status).toBe(200);
    expect((await res.json()).order.order_number).toBe(1002);
  });

  it("404s an order that isn't a number or isn't theirs", async () => {
    await seedOrders();
    const { GET } = await import('@/app/api/app/v1/orders/[orderNumber]/route');
    expect((await GET(await get('/orders/abc', await token()), orderContext('abc'))).status).toBe(404);
    expect((await GET(await get('/orders/2001', await token()), orderContext('2001'))).status).toBe(404);
  });

  it('serves assistants with plain-English permissions', async () => {
    const { recordAgentVisit } = await import('@/lib/agentSession/knownAgents');
    await recordAgentVisit(ALICE, 'agent-1', ['orders:read']);
    const { GET } = await import('@/app/api/app/v1/assistants/route');
    const res = await GET(await get('/assistants', await token()), noContext);
    const body = await res.json();
    expect(body.assistants).toHaveLength(1);
    expect(body.assistants[0].id).toBe('agent-1');
    expect(body.assistants[0].allowed[0]).not.toBe('orders:read');
    expect(typeof body.assistants[0].last_seen_at).toBe('string');
    expect(body.assistants[0].orders_placed).toBe(0);
  });

  it('serves who is signed in, and the categories', async () => {
    const me = (await import('@/app/api/app/v1/me/route')).GET;
    expect(await (await me(await get('/me', await token()), noContext)).json())
      .toEqual({ name: 'Alice Chen', email: 'alice@example.com' });
    const categories = (await import('@/app/api/app/v1/categories/route')).GET;
    const body = await (await categories(await get('/categories', await token()), noContext)).json();
    expect(body.categories[0]).toHaveProperty('slug');
  });

  it('refuses agent tokens on every route', async () => {
    const agent = await token({ act: { sub: 'agent-1' }, scope: 'openid orders:write' });
    for (const [path, mod, ctx] of [
      ['/me', '@/app/api/app/v1/me/route', noContext],
      ['/orders', '@/app/api/app/v1/orders/route', noContext],
      ['/orders/1002', '@/app/api/app/v1/orders/[orderNumber]/route', orderContext('1002')],
      ['/assistants', '@/app/api/app/v1/assistants/route', noContext],
      ['/categories', '@/app/api/app/v1/categories/route', noContext],
    ] as const) {
      const { GET } = await import(mod);
      expect((await GET(await get(path, agent), ctx)).status).toBe(401);
    }
  });

  it('refuses no token, without pointing anyone at resource metadata', async () => {
    const { GET } = await import('@/app/api/app/v1/orders/route');
    const res = await GET(await get('/orders'), noContext);
    expect(res.status).toBe(401);
    for (const [, value] of res.headers) expect(value).not.toContain('resource_metadata');
  });

  it('is not advertised to agents', async () => {
    const poppy = (await import('@/app/.well-known/poppy.json/route')).GET;
    const openapi = (await import('@/app/api/agent/v1/openapi.json/route')).GET;
    expect(await (await poppy(new Request(`${ORIGIN}/.well-known/poppy.json`))).text()).not.toContain('/api/app');
    expect(await (await openapi(new Request(`${ORIGIN}/api/agent/v1/openapi.json`))).text()).not.toContain('/api/app');
  });
});
