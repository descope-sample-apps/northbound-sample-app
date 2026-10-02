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

beforeEach(async () => {
  tdb = await withTestDb();
  ids = await seedMinimal(tdb);
  (globalThis as { __testDb?: unknown }).__testDb = tdb.db;
});

afterEach(async () => { await tdb.close(); });

const BIG_CAP: PurchaseAuthorizationDetail = {
  type: 'purchase',
  max_amount: { value: '2000.00', currency: 'USD' },
  merchant: 'northbound.example.com',
  period: 'P7D',
};

function agentContext(customerId = ids.alice): ActorContext {
  return {
    customerId,
    actor: { agentId: 'agent_shopping_assistant', clientId: 'c' },
    scopes: ['cart:read', 'cart:write', 'checkout'],
    authorizationDetails: [BIG_CAP],
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

/** Marks the customer as having shipped here before, so only the amount trips. */
async function seedPriorOrderTo(customerId: number, addressId: number) {
  const [card] = await tdb.db.select().from(schema.paymentMethods)
    .where(eq(schema.paymentMethods.customerId, customerId));

  await tdb.db.insert(schema.orders).values({
    orderNumber: 9_000 + customerId,
    customerId,
    status: 'delivered',
    placedAt: new Date(Date.now() - 60 * 86_400_000),
    subtotalCents: 1_000, taxCents: 85, shippingCents: 895, totalCents: 1_980,
    shippingAddressId: addressId,
    paymentMethodId: card.id,
    agentId: null,
  });
}

async function cart(ctx: ActorContext, productIndex: number, quantity: number) {
  const { clearCart, addToCart } = await import('@/lib/services/cart');
  await clearCart(ctx);
  await addToCart(ctx, ids.productIds[productIndex], quantity);
}

/** Approves whatever step-up the last failed checkout asked for. */
async function approveStepUp(fingerprint: string, customerId = ids.alice) {
  await tdb.db.insert(schema.backchannelRequests).values({
    id: `stepup-${Math.random().toString(36).slice(2)}`,
    clientId: null,
    agentId: null,
    agentDisplayName: 'Shopping Assistant',
    agentTier: 'verified-trusted',
    agentVerified: true,
    loginHint: 'alice@example.com',
    customerId,
    scope: 'checkout',
    bindingMessage: 'approve this order',
    bindingCode: '1234',
    stepUpFingerprint: fingerprint,
    status: 'approved',
    pollIntervalSeconds: 5,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 600_000),
  });
}

describe('an order at or over the threshold', () => {
  beforeEach(async () => {
    const { addressId } = await defaultsFor(ids.alice);
    await seedPriorOrderTo(ids.alice, addressId);
  });

  it('is held rather than refused, and says which order it means', async () => {
    const { placeOrder } = await import('@/lib/services/orders');
    const { StepUpRequiredError } = await import('@/lib/services/errors');
    const ctx = agentContext();
    await cart(ctx, 0, 1); // $420 pack

    const error = await placeOrder(ctx, await defaultsFor(ids.alice)).catch((e) => e);

    expect(error).toBeInstanceOf(StepUpRequiredError);
    expect(error.reason).toBe('amount');
    expect(error.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(error.totalCents).toBeGreaterThan(10_000);
  });

  it('leaves the cart and the stock untouched', async () => {
    const { getCart } = await import('@/lib/services/cart');
    const { placeOrder } = await import('@/lib/services/orders');
    const ctx = agentContext();
    await cart(ctx, 0, 1);

    const [before] = await tdb.db.select().from(schema.products)
      .where(eq(schema.products.id, ids.productIds[0]));

    await placeOrder(ctx, await defaultsFor(ids.alice)).catch(() => {});

    expect((await getCart(ctx)).items).toHaveLength(1);
    const [after] = await tdb.db.select().from(schema.products)
      .where(eq(schema.products.id, ids.productIds[0]));
    expect(after.stockQty).toBe(before.stockQty);
  });

  it('completes once the customer approves that exact order', async () => {
    const { placeOrder } = await import('@/lib/services/orders');
    const ctx = agentContext();
    await cart(ctx, 0, 1);
    const defaults = await defaultsFor(ids.alice);

    const error = await placeOrder(ctx, defaults).catch((e) => e);
    await approveStepUp(error.fingerprint);

    const order = await placeOrder(ctx, defaults);
    expect(order.orderNumber).toBeTruthy();
  });

  // THE LOAD-BEARING ONE. An approval is for one order, not for a mood.
  it('approving one order does not authorise a different one', async () => {
    const { placeOrder } = await import('@/lib/services/orders');
    const { StepUpRequiredError } = await import('@/lib/services/errors');
    const ctx = agentContext();
    const defaults = await defaultsFor(ids.alice);

    await cart(ctx, 0, 1);
    const first = await placeOrder(ctx, defaults).catch((e) => e);
    await approveStepUp(first.fingerprint);

    // A different basket entirely. The approval above must not cover it.
    await cart(ctx, 1, 1);
    await expect(placeOrder(ctx, defaults)).rejects.toBeInstanceOf(StepUpRequiredError);
  });

  it('is single-use — a second identical order needs its own approval', async () => {
    const { placeOrder } = await import('@/lib/services/orders');
    const { StepUpRequiredError } = await import('@/lib/services/errors');
    const ctx = agentContext();
    const defaults = await defaultsFor(ids.alice);

    await cart(ctx, 0, 1);
    const error = await placeOrder(ctx, defaults).catch((e) => e);
    await approveStepUp(error.fingerprint);
    await placeOrder(ctx, defaults);

    await cart(ctx, 0, 1);
    await expect(placeOrder(ctx, defaults)).rejects.toBeInstanceOf(StepUpRequiredError);
  });

  it('does not accept an approval the customer declined', async () => {
    const { placeOrder } = await import('@/lib/services/orders');
    const { StepUpRequiredError } = await import('@/lib/services/errors');
    const ctx = agentContext();
    const defaults = await defaultsFor(ids.alice);

    await cart(ctx, 0, 1);
    const error = await placeOrder(ctx, defaults).catch((e) => e);

    await approveStepUp(error.fingerprint);
    await tdb.db.update(schema.backchannelRequests)
      .set({ status: 'denied' })
      .where(eq(schema.backchannelRequests.stepUpFingerprint, error.fingerprint));

    await expect(placeOrder(ctx, defaults)).rejects.toBeInstanceOf(StepUpRequiredError);
  });

  it('does not accept another customer\'s approval', async () => {
    const { placeOrder } = await import('@/lib/services/orders');
    const { StepUpRequiredError } = await import('@/lib/services/errors');
    const ctx = agentContext();
    const defaults = await defaultsFor(ids.alice);

    await cart(ctx, 0, 1);
    const error = await placeOrder(ctx, defaults).catch((e) => e);
    await approveStepUp(error.fingerprint, ids.carol);

    await expect(placeOrder(ctx, defaults)).rejects.toBeInstanceOf(StepUpRequiredError);
  });
});

describe('a small order to an address never used before', () => {
  it('needs approval even well under the threshold', async () => {
    const { placeOrder } = await import('@/lib/services/orders');
    const { StepUpRequiredError } = await import('@/lib/services/errors');
    const ctx = agentContext();
    await cart(ctx, 2, 1); // $18 mug

    const error = await placeOrder(ctx, await defaultsFor(ids.alice)).catch((e) => e);

    expect(error).toBeInstanceOf(StepUpRequiredError);
    expect(error.reason).toBe('new_address');
  });

  it('stops asking once that address has been used', async () => {
    const { placeOrder } = await import('@/lib/services/orders');
    const ctx = agentContext();
    const defaults = await defaultsFor(ids.alice);
    await seedPriorOrderTo(ids.alice, defaults.addressId);

    await cart(ctx, 2, 1);
    await expect(placeOrder(ctx, defaults)).resolves.toBeTruthy();
  });
});

describe('a customer checking out themselves', () => {
  it('is never asked to step up — they are already the person who would be asked',
    async () => {
      const { addToCart } = await import('@/lib/services/cart');
      const { placeOrder } = await import('@/lib/services/orders');
      const human = browserContext(ids.alice);

      await addToCart(human, ids.productIds[0], 2); // $840, new address
      await expect(placeOrder(human, await defaultsFor(ids.alice))).resolves.toBeTruthy();
    });
});
