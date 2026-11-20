import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { withTestDb, seedMinimal, type TestDb } from './harness';

/**
 * The agent API, from the outside: what a request with no token gets, what a request with
 * the wrong one gets, and what the right one is allowed to do.
 *
 * resolveAgentToken is mocked rather than exercised — it has its own suite, and verifying
 * a real Descope signature here would make every one of these tests need a network. What
 * is under test is the layer above it: which scope each route demands, which customer the
 * session is bound to, and whether a refusal says enough for an agent to act on it.
 */

const ORIGIN = 'https://northbound.camp';
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
  // The routes ask through inspectAgentToken, which is resolveAgentToken plus the reason
  // a refusal happened. These tests are about which scope each route demands, not about
  // what a refusal says, so the reason is a placeholder — test/token-refusal-reasons.test.ts
  // is where it means anything.
  inspectAgentToken: async (token: string) => {
    const session = await resolveAgentToken(token);
    return session ? { session } : { session: null, reason: 'not a token this test accepts' };
  },
  descopeIssuer: async () => 'https://auth.northbound.camp/v1/apps/P1',
}));

beforeEach(async () => {
  tdb = await withTestDb();
  ids = await seedMinimal(tdb);
  (globalThis as { __testDb?: unknown }).__testDb = tdb.db;
  resolveAgentToken.mockReset();
});

afterEach(async () => {
  await tdb.close();
  delete process.env.DESCOPE_ISSUER;
});

/** A resolved session for a customer, carrying exactly these scopes. */
function signedIn(customerId: number, scopes: string[], agent = 'agent-under-test') {
  resolveAgentToken.mockImplementation(async (token: string) => {
    if (token !== 'good-token') return null;
    const [customer] = await tdb.db
      .select()
      .from(schema.customers)
      .where(eq(schema.customers.id, customerId));
    return { customer, agent, email: customer.email, scopes };
  });
}

function request(path: string, init: RequestInit & { token?: string } = {}) {
  const { token, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (rest.body) headers.set('content-type', 'application/json');
  return new Request(`${ORIGIN}${path}`, { ...rest, headers });
}

describe('refusing a request', () => {
  it('answers 401 with where to get a token when none was sent', async () => {
    const { GET } = await import('@/app/api/agent/v1/orders/route');

    const res = await GET(request('/api/agent/v1/orders'), undefined);

    expect(res.status).toBe(401);
    // RFC 9728 section 5.1: the challenge names the metadata, so a client that arrived
    // knowing nothing can find the authorization server from the refusal itself.
    expect(res.headers.get('www-authenticate')).toContain(
      `resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/api/agent/v1"`,
    );
  });

  it('answers 401 invalid_token for a token the store will not accept', async () => {
    resolveAgentToken.mockResolvedValue(null);
    const { GET } = await import('@/app/api/agent/v1/orders/route');

    const res = await GET(request('/api/agent/v1/orders', { token: 'forged' }), undefined);

    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('error="invalid_token"');
    // The reason is on the log, not in the body: it would tell whoever holds a forged
    // token exactly which claim to change next.
    expect((await res.json()).error_description).not.toMatch(/claim|customer|issuer/i);
  });

  it('answers 403 naming the scope to ask for when the customer never approved it', async () => {
    signedIn(ids.alice, ['orders:read']);
    const { POST } = await import('@/app/api/agent/v1/orders/route');

    const res = await POST(
      request('/api/agent/v1/orders', { method: 'POST', token: 'good-token', body: '{}' }),
      undefined,
    );

    expect(res.status).toBe(403);
    expect(res.headers.get('www-authenticate')).toContain('error="insufficient_scope"');
    expect(res.headers.get('www-authenticate')).toContain('scope="orders:write"');
  });

  // Being allowed to spend the customer's money on their saved card is strictly more than
  // being allowed to see what was spent. An assistant that could buy but not read back
  // what it bought would be a trap.
  it('lets orders:write read as well', async () => {
    signedIn(ids.alice, ['orders:write']);
    const { GET } = await import('@/app/api/agent/v1/orders/route');

    const res = await GET(request('/api/agent/v1/orders', { token: 'good-token' }), undefined);

    expect(res.status).toBe(200);
  });

  // The reverse is not true, and must not become true: orders:read is published to
  // customers as `changes: "none"`.
  it('does not let orders:read change the cart', async () => {
    signedIn(ids.alice, ['orders:read']);
    const { POST } = await import('@/app/api/agent/v1/cart/items/route');

    const res = await POST(
      request('/api/agent/v1/cart/items', {
        method: 'POST',
        token: 'good-token',
        body: JSON.stringify({ slug: 'trail-mug', quantity: 1 }),
      }),
      undefined,
    );

    expect(res.status).toBe(403);
  });
});

describe('reading orders', () => {
  it("returns only the token holder's own orders", async () => {
    await placeFor(ids.alice);
    await placeFor(ids.carol);

    signedIn(ids.alice, ['orders:read']);
    const { GET } = await import('@/app/api/agent/v1/orders/route');
    const body = await (await GET(
      request('/api/agent/v1/orders', { token: 'good-token' }),
      undefined,
    )).json();

    expect(body.orders).toHaveLength(1);
    expect(body.acting_for).toBe('alice@example.com');
    expect(body.actor).toBe('agent-under-test');
  });

  // getOrder scopes by customer and answers NOT FOUND rather than FORBIDDEN, because a
  // 403 would confirm the order exists.
  it("answers 404, not 403, for another customer's order", async () => {
    const orderNumber = await placeFor(ids.carol);

    signedIn(ids.alice, ['orders:read']);
    const { GET } = await import('@/app/api/agent/v1/orders/[orderNumber]/route');
    const res = await GET(
      request(`/api/agent/v1/orders/${orderNumber}`, { token: 'good-token' }),
      { params: Promise.resolve({ orderNumber: String(orderNumber) }) },
    );

    expect(res.status).toBe(404);
  });

  it('names what was bought, so "where is my parka" can be answered', async () => {
    const orderNumber = await placeFor(ids.alice);

    signedIn(ids.alice, ['orders:read']);
    const { GET } = await import('@/app/api/agent/v1/orders/[orderNumber]/route');
    const body = await (await GET(
      request(`/api/agent/v1/orders/${orderNumber}`, { token: 'good-token' }),
      { params: Promise.resolve({ orderNumber: String(orderNumber) }) },
    )).json();

    expect(body.order.items[0].name).toBe('Trail Enamel Mug');
    expect(body.order.status).toBe('placed');
    expect(body.order.url).toBe(`${ORIGIN}/orders/${orderNumber}`);
  });
});

describe('the cart', () => {
  // Sets rather than adds, so an agent that retries a timed-out request has said the same
  // thing twice instead of buying twice as much.
  it('sets a quantity rather than adding to it', async () => {
    signedIn(ids.alice, ['orders:write']);
    const { POST } = await import('@/app/api/agent/v1/cart/items/route');
    const body = JSON.stringify({ slug: 'trail-mug', quantity: 2 });

    await POST(request('/api/agent/v1/cart/items', { method: 'POST', token: 'good-token', body }), undefined);
    const res = await POST(
      request('/api/agent/v1/cart/items', { method: 'POST', token: 'good-token', body }),
      undefined,
    );

    const cart = (await res.json()).cart;
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0].quantity).toBe(2);
  });

  it('removes the line at quantity 0', async () => {
    signedIn(ids.alice, ['orders:write']);
    const { POST } = await import('@/app/api/agent/v1/cart/items/route');
    const send = (quantity: number) => POST(
      request('/api/agent/v1/cart/items', {
        method: 'POST',
        token: 'good-token',
        body: JSON.stringify({ slug: 'trail-mug', quantity }),
      }),
      undefined,
    );

    await send(3);
    const cart = (await (await send(0)).json()).cart;

    expect(cart.items).toEqual([]);
  });

  it('answers 404 for a slug the store does not sell', async () => {
    signedIn(ids.alice, ['orders:write']);
    const { POST } = await import('@/app/api/agent/v1/cart/items/route');

    const res = await POST(
      request('/api/agent/v1/cart/items', {
        method: 'POST',
        token: 'good-token',
        body: JSON.stringify({ slug: 'no-such-thing', quantity: 1 }),
      }),
      undefined,
    );

    expect(res.status).toBe(404);
  });
});

describe('placing an order', () => {
  it('buys the cart, defaults to the saved address and card, and records the agent', async () => {
    const { addToCart } = await import('@/lib/services/cart');
    await addToCart({ customerId: ids.alice }, ids.productIds[2], 2);

    signedIn(ids.alice, ['orders:write'], 'muse-assistant');
    const { POST } = await import('@/app/api/agent/v1/orders/route');
    const res = await POST(
      request('/api/agent/v1/orders', { method: 'POST', token: 'good-token', body: '{}' }),
      undefined,
    );

    expect(res.status).toBe(201);
    const { order } = await res.json();
    expect(order.items[0].quantity).toBe(2);
    // The customer sees this in their own order history, and /account/assistants counts it.
    expect(order.placed_by_agent).toBe('muse-assistant');
    expect(order.payment_method.last4).toBe('4242');
    expect(order.payment_method).not.toHaveProperty('holder_name');
  });

  // The guardrail. placeOrder refuses to charge a total the agent did not confirm, so a
  // price that moved comes back as a refusal rather than as a surprise on the card.
  it('refuses a total the agent did not confirm', async () => {
    const { addToCart } = await import('@/lib/services/cart');
    await addToCart({ customerId: ids.alice }, ids.productIds[2], 1);

    signedIn(ids.alice, ['orders:write']);
    const { POST } = await import('@/app/api/agent/v1/orders/route');
    const res = await POST(
      request('/api/agent/v1/orders', {
        method: 'POST',
        token: 'good-token',
        body: JSON.stringify({ expected_total_cents: 1 }),
      }),
      undefined,
    );

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('price_changed');
  });

  it('refuses an empty cart with 400 rather than placing nothing', async () => {
    signedIn(ids.alice, ['orders:write']);
    const { POST } = await import('@/app/api/agent/v1/orders/route');

    const res = await POST(
      request('/api/agent/v1/orders', { method: 'POST', token: 'good-token', body: '{}' }),
      undefined,
    );

    expect(res.status).toBe(400);
  });

  // An agent may spend the customer's money; it may not decide where the parcel goes or
  // which card pays. Both ids are looked up scoped by customer inside placeOrder.
  it("refuses another customer's address", async () => {
    const { addToCart } = await import('@/lib/services/cart');
    await addToCart({ customerId: ids.alice }, ids.productIds[2], 1);
    const carols = await defaultsFor(ids.carol);

    signedIn(ids.alice, ['orders:write']);
    const { POST } = await import('@/app/api/agent/v1/orders/route');
    const res = await POST(
      request('/api/agent/v1/orders', {
        method: 'POST',
        token: 'good-token',
        body: JSON.stringify({ address_id: carols.addressId }),
      }),
      undefined,
    );

    expect(res.status).toBe(403);
  });
});

describe('the catalog', () => {
  // Browsing is public to people, so it is public to their assistants. A scope here would
  // mean asking the customer for access before answering a question the website answers
  // to anyone.
  it('needs no token', async () => {
    const { GET } = await import('@/app/api/agent/v1/products/route');

    const res = await GET(request('/api/agent/v1/products?q=mug'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.products.map((p: { slug: string }) => p.slug)).toEqual(['trail-mug']);
  });

  // THE LINK, SAID RATHER THAN GUESSED. An assistant that names a product wants to link
  // it, and the only hint it had was this API's own path — /products, plural, while the
  // page is singular. Assistants guessed the plural and sent customers to a 404.
  it('gives each product the URL of its page', async () => {
    const { GET } = await import('@/app/api/agent/v1/products/route');

    const res = await GET(request('/api/agent/v1/products?q=mug'));

    const body = await res.json();
    expect(body.products[0].url).toBe(`${ORIGIN}/product/trail-mug`);
    expect(body.products[0].url).not.toContain('/products/');
  });

  // The two halves of that promise live in different files, so this is what stops them
  // drifting: the URL above is only true while a page answers at that path.
  it('names a path the website actually serves', () => {
    expect(existsSync('app/product/[slug]/page.tsx')).toBe(true);
  });
});

describe('the documents an agent discovers this API through', () => {
  it('names the API as its own resource, on the host it was asked on', async () => {
    const { GET } = await import('@/app/api/agent/v1/openapi.json/route');

    const doc = await (await GET(request('/api/agent/v1/openapi.json'))).json();

    // servers[0].url IS the resource identifier: what tokens are minted for, and what the
    // protected resource metadata has to repeat character for character.
    expect(doc.servers[0].url).toBe(`${ORIGIN}/api/agent/v1`);
    expect(doc.openapi).toBe('3.1.0');
  });

  it('describes every endpoint the routes expose', async () => {
    const { GET } = await import('@/app/api/agent/v1/openapi.json/route');
    const doc = await (await GET(request('/api/agent/v1/openapi.json'))).json();

    expect(Object.keys(doc.paths).sort()).toEqual([
      '/cart', '/cart/items', '/checkout-options', '/orders', '/orders/{orderNumber}', '/products',
    ]);
  });

  it('publishes metadata whose resource is exactly that URL', async () => {
    process.env.DESCOPE_ISSUER = 'https://auth.northbound.camp/v1/apps/P3KIVAYZ';
    const { GET } = await import(
      '@/app/.well-known/oauth-protected-resource/api/agent/v1/route'
    );

    const body = await (await GET(
      request('/.well-known/oauth-protected-resource/api/agent/v1'),
    )).json();

    // A document whose `resource` names anything else is one a client discards: it asked
    // about one resource and was answered about another.
    expect(body.resource).toBe(`${ORIGIN}/api/agent/v1`);
    expect(body.authorization_servers).toEqual([
      'https://auth.northbound.camp/v1/apps/P3KIVAYZ',
    ]);
    expect(body.scopes_supported).toEqual(['orders:read', 'orders:write']);
  });

  // The path is derived, not written down: RFC 9728 puts the well-known segment BETWEEN
  // the origin and the resource's path, and a client builds the same URL for itself.
  it('is published where a client will look for it', async () => {
    const { resourceMetadataUrl } = await import('@/lib/api/resource');

    expect(resourceMetadataUrl(request('/api/agent/v1/orders'))).toBe(
      `${ORIGIN}/.well-known/oauth-protected-resource/api/agent/v1`,
    );
  });

  // The defect this caught in production: Vercel reports x-forwarded-host as
  // www.northbound.camp even for a request to the apex, so the resource identifier and
  // the 401's resource_metadata both named a host that organization.domain does not.
  it('names this site by the domain it publishes, whatever the proxy says', async () => {
    const { apiBaseUrl } = await import('@/lib/api/resource');
    const forwarded = new Request('http://10.0.0.1/api/agent/v1/orders', {
      headers: { 'x-forwarded-host': 'www.northbound.camp', 'x-forwarded-proto': 'https' },
    });

    expect(apiBaseUrl(forwarded)).toBe(`${ORIGIN}/api/agent/v1`);
  });

  // PUBLIC_ORIGIN still wins, because a deployment that knows better has to be able to
  // say so without editing code.
  it('lets PUBLIC_ORIGIN override the lot', async () => {
    process.env.PUBLIC_ORIGIN = 'https://staging.northbound.camp';
    try {
      const { apiBaseUrl } = await import('@/lib/api/resource');

      expect(apiBaseUrl(request('/api/agent/v1/orders')))
        .toBe('https://staging.northbound.camp/api/agent/v1');
    } finally {
      delete process.env.PUBLIC_ORIGIN;
    }
  });
});

async function defaultsFor(customerId: number) {
  const [address] = await tdb.db.select().from(schema.addresses)
    .where(eq(schema.addresses.customerId, customerId));
  const [payment] = await tdb.db.select().from(schema.paymentMethods)
    .where(eq(schema.paymentMethods.customerId, customerId));
  return { addressId: address.id, paymentMethodId: payment.id };
}

async function placeFor(customerId: number): Promise<number> {
  const { addToCart } = await import('@/lib/services/cart');
  const { placeOrder } = await import('@/lib/services/orders');
  await addToCart({ customerId }, ids.productIds[2], 1);
  const order = await placeOrder(customerId, await defaultsFor(customerId));
  return order.orderNumber;
}
