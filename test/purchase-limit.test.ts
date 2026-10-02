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

  // These tests are about the spending CAP. Step-up is a separate guard with
  // its own file, and it fires on a never-used delivery address — so seed one
  // prior order to Alice's address, and keep every amount below the $100
  // step-up threshold, so only the cap is under test here.
  const [address] = await tdb.db.select().from(schema.addresses)
    .where(eq(schema.addresses.customerId, ids.alice));
  const [card] = await tdb.db.select().from(schema.paymentMethods)
    .where(eq(schema.paymentMethods.customerId, ids.alice));

  await tdb.db.insert(schema.orders).values({
    orderNumber: 9001,
    customerId: ids.alice,
    status: 'delivered',
    placedAt: new Date(Date.now() - 90 * 86_400_000),
    subtotalCents: 1_000, taxCents: 85, shippingCents: 895, totalCents: 1_980,
    shippingAddressId: address.id,
    paymentMethodId: card.id,
    agentId: null,
  });
});

afterEach(async () => { await tdb.close(); });

const cap = (value: string, period = 'P7D'): PurchaseAuthorizationDetail => ({
  type: 'purchase',
  max_amount: { value, currency: 'USD' },
  merchant: 'northbound.example.com',
  period,
});

function agentContext(options: {
  customerId?: number;
  agentId?: string;
  grant?: PurchaseAuthorizationDetail | null;
} = {}): ActorContext {
  return {
    customerId: options.customerId ?? ids.alice,
    actor: { agentId: options.agentId ?? 'agent_shopping_assistant', clientId: 'c' },
    scopes: ['cart:read', 'cart:write', 'checkout', 'orders:read'],
    authorizationDetails: options.grant === null ? [] : [options.grant ?? cap('200.00')],
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

/** Puts a basket of roughly `targetCents` in the cart. */
async function fillCart(ctx: ActorContext, targetCents: number) {
  const { addToCart, clearCart } = await import('@/lib/services/cart');
  await clearCart(ctx);
  // Trail mug is $18.00; quantities keep the arithmetic obvious.
  const quantity = Math.max(1, Math.round(targetCents / 1_800));
  await addToCart(ctx, ids.productIds[2], Math.min(quantity, 99));
}

describe('a customer buying for themselves', () => {
  it('has no cap at all', async () => {
    const { addToCart } = await import('@/lib/services/cart');
    const { placeOrder } = await import('@/lib/services/orders');
    const ctx = browserContext(ids.alice);

    await addToCart(ctx, ids.productIds[0], 2); // $840 of packs
    const order = await placeOrder(ctx, await defaultsFor(ids.alice));

    expect(order.totalCents).toBeGreaterThan(80_000);
    expect(order.agentId).toBeNull();
  });
});

describe('an agent with a $200 cap', () => {
  it('places a $90 order', async () => {
    const { placeOrder } = await import('@/lib/services/orders');
    const ctx = agentContext();
    await fillCart(ctx, 9_000);

    const order = await placeOrder(ctx, await defaultsFor(ids.alice));
    expect(order.totalCents).toBeLessThanOrEqual(20_000);
    expect(order.agentId).toBe('agent_shopping_assistant');
  });

  /**
   * Worth being explicit about, because the two guards interact.
   *
   * A $140 order is UNDER the $200 cap and OVER the $100 step-up threshold. It
   * is permitted by the grant and still needs the customer to approve that
   * specific order — which is the combination the blog's walkthrough describes,
   * where "$140 goes through" means the cap allows it, not that nothing else is
   * asked.
   */
  it('still asks for a step-up on a $140 order the cap allows', async () => {
    const { placeOrder } = await import('@/lib/services/orders');
    const { StepUpRequiredError } = await import('@/lib/services/errors');
    const ctx = agentContext();
    await fillCart(ctx, 14_000);

    await expect(placeOrder(ctx, await defaultsFor(ids.alice)))
      .rejects.toBeInstanceOf(StepUpRequiredError);
  });

  // The cap is checked BEFORE step-up: telling the customer "you may never
  // spend this much" beats asking them to approve something that would be
  // refused immediately afterwards.
  it('is refused a $260 order outright, with something it can relay', async () => {
    const { placeOrder } = await import('@/lib/services/orders');
    const { PurchaseLimitError } = await import('@/lib/services/errors');
    const ctx = agentContext();
    await fillCart(ctx, 26_000);

    const error = await placeOrder(ctx, await defaultsFor(ids.alice)).catch((e) => e);

    expect(error).toBeInstanceOf(PurchaseLimitError);
    expect(error.limitCents).toBe(20_000);
    expect(error.message).toMatch(/\$200\.00/);
    expect(error.message).toMatch(/\$2[0-9]{2}\.\d{2}/);
  });

  it('leaves the cart alone when it refuses', async () => {
    const { getCart } = await import('@/lib/services/cart');
    const { placeOrder } = await import('@/lib/services/orders');
    const ctx = agentContext();
    await fillCart(ctx, 26_000);

    await placeOrder(ctx, await defaultsFor(ids.alice)).catch(() => {});

    expect((await getCart(ctx)).items).toHaveLength(1);

    // The fixture seeds one historical order placed by the customer; what must
    // not exist is an order placed by the agent.
    const placed = await tdb.db.select().from(schema.orders);
    expect(placed.filter((o) => o.agentId !== null)).toHaveLength(0);
  });
});

/**
 * period: "P7D" means $200 across seven days, not $200 per order.
 *
 * A cap that silently reset per order would look identical in a demo and be
 * worth nothing in production, which is exactly why it gets its own tests.
 */
describe('the period window', () => {
  it('accumulates across orders until the cap is exhausted', async () => {
    const { placeOrder } = await import('@/lib/services/orders');
    const { PurchaseLimitError } = await import('@/lib/services/errors');
    const ctx = agentContext();
    const defaults = await defaultsFor(ids.alice);

    await fillCart(ctx, 9_000);
    await placeOrder(ctx, defaults);
    await fillCart(ctx, 9_000);
    await placeOrder(ctx, defaults);

    // Two orders of about $90 have used most of the $200. Each is under the
    // step-up threshold, so only the cap decides.
    await fillCart(ctx, 9_000);
    await expect(placeOrder(ctx, defaults)).rejects.toBeInstanceOf(PurchaseLimitError);
  });

  it('ignores orders placed before the window opened', async () => {
    const { placeOrder } = await import('@/lib/services/orders');
    const ctx = agentContext();
    const defaults = await defaultsFor(ids.alice);

    await fillCart(ctx, 9_000);
    const old = await placeOrder(ctx, defaults);

    // Eight days ago — outside a P7D window.
    await tdb.db.update(schema.orders)
      .set({ placedAt: new Date(Date.now() - 8 * 86_400_000) })
      .where(eq(schema.orders.id, old.id));

    await fillCart(ctx, 9_000);
    await expect(placeOrder(ctx, defaults)).resolves.toBeTruthy();
  });

  it('does not count what the customer bought themselves', async () => {
    const { addToCart } = await import('@/lib/services/cart');
    const { placeOrder } = await import('@/lib/services/orders');
    const human = browserContext(ids.alice);
    const defaults = await defaultsFor(ids.alice);

    await addToCart(human, ids.productIds[0], 1); // $420, far over the agent's cap
    await placeOrder(human, defaults);

    const ctx = agentContext();
    await fillCart(ctx, 9_000);
    await expect(placeOrder(ctx, defaults)).resolves.toBeTruthy();
  });

  it('does not count another agent\'s orders against this one', async () => {
    const { placeOrder } = await import('@/lib/services/orders');
    const defaults = await defaultsFor(ids.alice);

    const other = agentContext({ agentId: 'agent_pantry_bot' });
    await fillCart(other, 9_000);
    await placeOrder(other, defaults);

    const mine = agentContext({ agentId: 'agent_shopping_assistant' });
    await fillCart(mine, 9_000);
    await expect(placeOrder(mine, defaults)).resolves.toBeTruthy();
  });
});

describe('an agent with no purchase grant', () => {
  // The declared and unverified tiers get read-only scopes, but a scope check
  // lives at the API edge. The service must refuse too, or any other caller
  // could place the order the API would have blocked.
  it('cannot check out even holding the checkout scope', async () => {
    const { placeOrder } = await import('@/lib/services/orders');
    const { PurchaseLimitError } = await import('@/lib/services/errors');
    const ctx = agentContext({ grant: null });
    await fillCart(ctx, 5_000);

    const error = await placeOrder(ctx, await defaultsFor(ids.alice)).catch((e) => e);
    expect(error).toBeInstanceOf(PurchaseLimitError);
    expect(error.message).toMatch(/not approved to buy|no spending/i);
  });
});

describe('the cap comes from the token and nowhere else', () => {
  it('ignores a larger cap presented as a different authorization_details entry',
    async () => {
      const { placeOrder } = await import('@/lib/services/orders');
      const { PurchaseLimitError } = await import('@/lib/services/errors');

      // Two grants, the second more generous. Only the purchase grant the
      // customer approved should count, and there is only ever one.
      const ctx = agentContext();
      ctx.authorizationDetails = [cap('50.00'), cap('5000.00')];

      await fillCart(ctx, 9_000);
      await expect(placeOrder(ctx, await defaultsFor(ids.alice)))
        .rejects.toBeInstanceOf(PurchaseLimitError);
    });

  it('rejects a malformed amount rather than treating it as unlimited', async () => {
    const { placeOrder } = await import('@/lib/services/orders');
    const { ServiceError } = await import('@/lib/services/errors');

    const ctx = agentContext({
      grant: { ...cap('200.00'), max_amount: { value: 'lots', currency: 'USD' } },
    });
    await fillCart(ctx, 5_000);

    const error = await placeOrder(ctx, await defaultsFor(ids.alice)).catch((e) => e);
    expect(error).toBeInstanceOf(ServiceError);
  });
});

/**
 * Some things no agent may do, at any trust level.
 *
 * Not "requires a scope" — closed. A stored card an agent added outlives the
 * grant, and a changed account detail is the kind of mistake a customer cannot
 * undo themselves.
 */
describe('operations closed to agents outright', () => {
  const CARD = {
    brand: 'visa' as const, last4: '1881', expMonth: 9,
    expYear: 2031, holderName: 'Alice Chen',
  };

  it('refuses an agent adding a payment method, whatever it holds', async () => {
    const { addPaymentMethod } = await import('@/lib/services/paymentMethods');
    const { AgentForbiddenError } = await import('@/lib/services/errors');

    const ctx = agentContext();
    // Deliberately handed the scope it would need, to show the scope is not
    // what is stopping it.
    ctx.scopes = [...ctx.scopes, 'payment_methods:write'];

    await expect(addPaymentMethod(ctx, CARD)).rejects.toBeInstanceOf(AgentForbiddenError);
  });

  it('refuses an agent removing or re-defaulting a payment method', async () => {
    const { listPaymentMethods, deletePaymentMethod, setDefaultPaymentMethod } =
      await import('@/lib/services/paymentMethods');
    const { AgentForbiddenError } = await import('@/lib/services/errors');

    const [card] = await listPaymentMethods(browserContext(ids.alice));
    const ctx = agentContext();

    await expect(deletePaymentMethod(ctx, card.id))
      .rejects.toBeInstanceOf(AgentForbiddenError);
    await expect(setDefaultPaymentMethod(ctx, card.id))
      .rejects.toBeInstanceOf(AgentForbiddenError);
  });

  it('refuses an agent changing account details', async () => {
    const { updateProfile } = await import('@/lib/services/profile');
    const { AgentForbiddenError } = await import('@/lib/services/errors');

    await expect(updateProfile(agentContext(), { name: 'Renamed By Agent' }))
      .rejects.toBeInstanceOf(AgentForbiddenError);
  });

  it('still lets the customer do all of it themselves', async () => {
    const { addPaymentMethod, listPaymentMethods } =
      await import('@/lib/services/paymentMethods');
    const { updateProfile, getProfile } = await import('@/lib/services/profile');
    const human = browserContext(ids.alice);

    await addPaymentMethod(human, CARD);
    expect(await listPaymentMethods(human)).toHaveLength(2);

    await updateProfile(human, { name: 'Alice C.' });
    expect((await getProfile(human)).name).toBe('Alice C.');
  });
});
