import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { withTestDb, seedMinimal, type TestDb } from './harness';
import { browserContext, type ActorContext, type PurchaseAuthorizationDetail } from '@/lib/oauth/types';

let tdb: TestDb;
let ids: Awaited<ReturnType<typeof seedMinimal>>;

vi.mock('@/db/client', () => ({
  get db() {
    return (globalThis as { __testDb?: unknown }).__testDb;
  },
}));

const CAP: PurchaseAuthorizationDetail = {
  type: 'purchase',
  max_amount: { value: '200.00', currency: 'USD' },
  merchant: 'northbound.example.com',
  period: 'P7D',
};

function agentContext(): ActorContext {
  return {
    customerId: ids.alice,
    actor: { agentId: 'agent_shopping_assistant', clientId: 'c' },
    scopes: ['cart:write', 'checkout'],
    authorizationDetails: [CAP],
    source: 'api',
  };
}

async function defaultsFor(customerId: number) {
  const [address] = await tdb.db.select().from(schema.addresses)
    .where(eq(schema.addresses.customerId, customerId));
  const [card] = await tdb.db.select().from(schema.paymentMethods)
    .where(eq(schema.paymentMethods.customerId, customerId));
  return { addressId: address.id, paymentMethodId: card.id };
}

beforeEach(async () => {
  tdb = await withTestDb();
  ids = await seedMinimal(tdb);
  (globalThis as { __testDb?: unknown }).__testDb = tdb.db;

  // tokens.agentId references agents.id, and seedMinimal does not seed agents.
  await tdb.db.insert(schema.agents).values([
    { id: 'agent_shopping_assistant', displayName: 'Shopping Assistant',
      owner: 'Northbound Labs', createdAt: new Date() },
    { id: 'agent_pantry_bot', displayName: 'Pantry Bot',
      owner: 'Example Automations', createdAt: new Date() },
  ]);

  // A prior order to Alice's address, so step-up does not fire on destination
  // and the events under test are the ones each case is about.
  const { addressId, paymentMethodId } = await defaultsFor(ids.alice);
  await tdb.db.insert(schema.orders).values({
    orderNumber: 9001, customerId: ids.alice, status: 'delivered',
    placedAt: new Date(Date.now() - 90 * 86_400_000),
    subtotalCents: 1_000, taxCents: 85, shippingCents: 895, totalCents: 1_980,
    shippingAddressId: addressId, paymentMethodId, agentId: null,
  });
});

afterEach(async () => { await tdb.close(); });

async function cart(ctx: ActorContext, index: number, quantity: number) {
  const { clearCart, addToCart } = await import('@/lib/services/cart');
  await clearCart(ctx);
  await addToCart(ctx, ids.productIds[index], quantity);
}

describe('both identities on every row', () => {
  it('records an agent order with the agent named', async () => {
    const { placeOrder } = await import('@/lib/services/orders');
    const { listActivity } = await import('@/lib/services/audit');
    const ctx = agentContext();

    await cart(ctx, 2, 3); // 3 mugs, under both thresholds
    const order = await placeOrder(ctx, await defaultsFor(ids.alice));

    const [event] = await listActivity(browserContext(ids.alice));
    expect(event.action).toBe('order_placed');
    expect(event.agentId).toBe('agent_shopping_assistant');
    expect(event.orderNumber).toBe(order.orderNumber);
    expect(event.amountCents).toBe(order.totalCents);
  });

  // The difference has to be visible side by side, which is what impersonation
  // destroys: there, every row would say the customer did it.
  it('records a customer order with no actor at all', async () => {
    const { placeOrder } = await import('@/lib/services/orders');
    const { listActivity } = await import('@/lib/services/audit');
    const human = browserContext(ids.alice);

    await cart(human, 2, 1);
    await placeOrder(human, await defaultsFor(ids.alice));

    const [event] = await listActivity(human);
    expect(event.agentId).toBeNull();
    expect(event.agentDisplayName).toBeNull();
  });

  it('keeps one customer\'s activity out of another\'s', async () => {
    const { placeOrder } = await import('@/lib/services/orders');
    const { listActivity } = await import('@/lib/services/audit');

    await cart(browserContext(ids.alice), 2, 1);
    await placeOrder(browserContext(ids.alice), await defaultsFor(ids.alice));

    expect(await listActivity(browserContext(ids.carol))).toEqual([]);
  });
});

describe('refusals are logged, because that is what a support call is about', () => {
  it('records an order refused for exceeding the limit', async () => {
    const { placeOrder } = await import('@/lib/services/orders');
    const { listActivity } = await import('@/lib/services/audit');
    const ctx = agentContext();

    await cart(ctx, 0, 1); // $420 pack, over the $200 cap
    await placeOrder(ctx, await defaultsFor(ids.alice)).catch(() => {});

    const events = await listActivity(browserContext(ids.alice));
    expect(events.some((e) => e.action === 'order_refused')).toBe(true);
    expect(events[0].agentId).toBe('agent_shopping_assistant');
  });

  it('records an attempt at something agents may never do', async () => {
    const { addPaymentMethod } = await import('@/lib/services/paymentMethods');
    const { listActivity } = await import('@/lib/services/audit');

    await addPaymentMethod(agentContext(), {
      brand: 'visa', last4: '1881', expMonth: 9, expYear: 2031, holderName: 'A',
    }).catch(() => {});

    const [event] = await listActivity(browserContext(ids.alice));
    expect(event.action).toBe('agent_refused');
    expect(event.summary).toMatch(/payment method/i);
  });
});

describe('the sentence the page shows', () => {
  it('reads the way the blog describes it', async () => {
    const { describe: describeEvent } = await import('@/lib/services/audit');

    const line = describeEvent({
      id: 1, customerId: ids.alice,
      agentId: 'agent_shopping_assistant',
      agentDisplayName: 'Shopping Assistant',
      action: 'order_placed',
      summary: 'Order #10241 placed.',
      orderNumber: 10241, amountCents: 90_000,
      createdAt: new Date(),
    }, 'Alice');

    expect(line).toBe(
      'Shopping Assistant, acting on behalf of Alice, placed order #10241 for $900.00.',
    );
  });

  it('drops the actor clause entirely for the customer\'s own action', async () => {
    const { describe: describeEvent } = await import('@/lib/services/audit');

    const line = describeEvent({
      id: 2, customerId: ids.alice, agentId: null, agentDisplayName: null,
      action: 'order_placed', summary: 'Order #10242 placed.',
      orderNumber: 10242, amountCents: 4_200, createdAt: new Date(),
    }, 'Alice');

    expect(line).toBe('Alice placed order #10242 for $42.00.');
    expect(line).not.toMatch(/acting on behalf/);
  });
});

describe('revoking an agent', () => {
  it('kills its live tokens without touching the customer\'s session', async () => {
    const { createSession, resolveSession } = await import('@/lib/auth/session');
    const { revokeAgentAccess } = await import('@/lib/services/agentAccess');
    const { randomUUID, createHash } = await import('node:crypto');

    const session = await createSession(ids.alice);
    await tdb.db.insert(schema.tokens).values({
      id: randomUUID(), kind: 'access',
      tokenHash: createHash('sha256').update('t').digest('hex'),
      jti: randomUUID(), clientId: null, agentId: 'agent_shopping_assistant',
      customerId: ids.alice, scope: 'orders:read',
      createdAt: new Date(), expiresAt: new Date(Date.now() + 900_000),
    });

    const revoked = await revokeAgentAccess(
      browserContext(ids.alice), 'agent_shopping_assistant', 'Shopping Assistant',
    );

    expect(revoked).toBe(1);
    // The whole point: the customer is still signed in to their own account.
    expect((await resolveSession(session))?.id).toBe(ids.alice);
  });

  it('is logged as the customer\'s action, naming the agent', async () => {
    const { revokeAgentAccess } = await import('@/lib/services/agentAccess');
    const { listActivity } = await import('@/lib/services/audit');

    await revokeAgentAccess(
      browserContext(ids.alice), 'agent_shopping_assistant', 'Shopping Assistant',
    );

    const [event] = await listActivity(browserContext(ids.alice));
    expect(event.action).toBe('access_revoked');
    expect(event.agentId).toBeNull();
    expect(event.agentDisplayName).toBe('Shopping Assistant');
  });

  // An agent must not be able to revoke a rival, or itself to cover its tracks.
  it('cannot be done by an agent', async () => {
    const { revokeAgentAccess } = await import('@/lib/services/agentAccess');
    const { AgentForbiddenError } = await import('@/lib/services/errors');

    await expect(
      revokeAgentAccess(agentContext(), 'agent_pantry_bot', 'Pantry Bot'),
    ).rejects.toBeInstanceOf(AgentForbiddenError);
  });

  it('leaves another customer\'s grants to the same agent alone', async () => {
    const { revokeAgentAccess } = await import('@/lib/services/agentAccess');
    const { randomUUID, createHash } = await import('node:crypto');

    await tdb.db.insert(schema.tokens).values({
      id: randomUUID(), kind: 'access',
      tokenHash: createHash('sha256').update('carol').digest('hex'),
      jti: randomUUID(), clientId: null, agentId: 'agent_shopping_assistant',
      customerId: ids.carol, scope: 'orders:read',
      createdAt: new Date(), expiresAt: new Date(Date.now() + 900_000),
    });

    await revokeAgentAccess(
      browserContext(ids.alice), 'agent_shopping_assistant', 'Shopping Assistant',
    );

    const [carolToken] = await tdb.db.select().from(schema.tokens)
      .where(eq(schema.tokens.customerId, ids.carol));
    expect(carolToken.revokedAt).toBeNull();
  });
});
