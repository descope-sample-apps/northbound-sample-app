import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { withTestDb, seedMinimal, type TestDb } from './harness';
import { browserContext } from '@/lib/oauth/types';

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

async function defaultsFor(customerId: number) {
  const [address] = await tdb.db.select().from(schema.addresses)
    .where(eq(schema.addresses.customerId, customerId));
  const [payment] = await tdb.db.select().from(schema.paymentMethods)
    .where(eq(schema.paymentMethods.customerId, customerId));
  return { addressId: address.id, paymentMethodId: payment.id };
}

const pack = () => ids.productIds[0];  // $420.00, stock 10
const shell = () => ids.productIds[1]; // $480.00, stock 1
const mug = () => ids.productIds[2];   // $18.00,  stock 50

describe('placeOrder', () => {
  it('places an order, snapshots names and prices, and clears the cart', async () => {
    const { addToCart, getCart } = await import('@/lib/services/cart');
    const { placeOrder } = await import('@/lib/services/orders');
    await addToCart(browserContext(ids.alice), pack(), 2);

    const order = await placeOrder(browserContext(ids.alice), await defaultsFor(ids.alice));

    expect(order.subtotalCents).toBe(84_000);
    expect(order.shippingCents).toBe(0);
    expect(order.taxCents).toBe(7_140);
    expect(order.totalCents).toBe(91_140);
    expect(order.status).toBe('placed');

    const items = await tdb.db.select().from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, order.id));
    expect(items[0].nameSnapshot).toBe('Cascade 45L Expedition Pack');
    expect(items[0].unitPriceCents).toBe(42_000);
    expect(items[0].lineTotalCents).toBe(84_000);

    expect((await getCart(browserContext(ids.alice))).items).toEqual([]);
  });

  it('numbers the first order 10241', async () => {
    const { addToCart } = await import('@/lib/services/cart');
    const { placeOrder } = await import('@/lib/services/orders');
    await addToCart(browserContext(ids.alice), mug(), 1);
    expect((await placeOrder(browserContext(ids.alice), await defaultsFor(ids.alice))).orderNumber)
      .toBe(10_241);
  });

  it('increments the order number for the next order', async () => {
    const { addToCart } = await import('@/lib/services/cart');
    const { placeOrder } = await import('@/lib/services/orders');
    await addToCart(browserContext(ids.alice), mug(), 1);
    await placeOrder(browserContext(ids.alice), await defaultsFor(ids.alice));
    await addToCart(browserContext(ids.carol), mug(), 1);
    expect((await placeOrder(browserContext(ids.carol), await defaultsFor(ids.carol))).orderNumber)
      .toBe(10_242);
  });

  it('decrements stock by the ordered quantity', async () => {
    const { addToCart } = await import('@/lib/services/cart');
    const { placeOrder } = await import('@/lib/services/orders');
    await addToCart(browserContext(ids.alice), pack(), 3);
    await placeOrder(browserContext(ids.alice), await defaultsFor(ids.alice));
    const [product] = await tdb.db.select().from(schema.products)
      .where(eq(schema.products.id, pack()));
    expect(product.stockQty).toBe(7);
  });

  it('refuses to place an empty order', async () => {
    const { placeOrder } = await import('@/lib/services/orders');
    const { ValidationError } = await import('@/lib/services/errors');
    await expect(placeOrder(browserContext(ids.alice), await defaultsFor(ids.alice)))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it('refuses an address belonging to another customer', async () => {
    const { addToCart } = await import('@/lib/services/cart');
    const { placeOrder } = await import('@/lib/services/orders');
    const { OwnershipError } = await import('@/lib/services/errors');
    await addToCart(browserContext(ids.alice), mug(), 1);
    const carol = await defaultsFor(ids.carol);
    const alice = await defaultsFor(ids.alice);
    await expect(placeOrder(browserContext(ids.alice), {
      addressId: carol.addressId, paymentMethodId: alice.paymentMethodId,
    })).rejects.toBeInstanceOf(OwnershipError);
  });

  it('refuses a payment method belonging to another customer', async () => {
    const { addToCart } = await import('@/lib/services/cart');
    const { placeOrder } = await import('@/lib/services/orders');
    const { OwnershipError } = await import('@/lib/services/errors');
    await addToCart(browserContext(ids.alice), mug(), 1);
    const carol = await defaultsFor(ids.carol);
    const alice = await defaultsFor(ids.alice);
    await expect(placeOrder(browserContext(ids.alice), {
      addressId: alice.addressId, paymentMethodId: carol.paymentMethodId,
    })).rejects.toBeInstanceOf(OwnershipError);
  });

  // REVIEW FOCUS 2: a cart item goes inactive between add and checkout.
  it('names the product when one in the cart was deactivated', async () => {
    const { addToCart } = await import('@/lib/services/cart');
    const { placeOrder } = await import('@/lib/services/orders');
    const { ValidationError } = await import('@/lib/services/errors');
    await addToCart(browserContext(ids.alice), pack(), 1);
    await tdb.db.update(schema.products).set({ isActive: false })
      .where(eq(schema.products.id, pack()));

    const error = await placeOrder(browserContext(ids.alice), await defaultsFor(ids.alice)).catch((e) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.message).toContain('Cascade 45L Expedition Pack');
  });

  // REVIEW FOCUS 2: stock falls below the cart quantity between add and checkout.
  it('fails with OutOfStockError when stock dropped after the item was added', async () => {
    const { addToCart } = await import('@/lib/services/cart');
    const { placeOrder } = await import('@/lib/services/orders');
    const { OutOfStockError } = await import('@/lib/services/errors');
    await addToCart(browserContext(ids.alice), pack(), 5);
    await tdb.db.update(schema.products).set({ stockQty: 2 })
      .where(eq(schema.products.id, pack()));

    const error = await placeOrder(browserContext(ids.alice), await defaultsFor(ids.alice)).catch((e) => e);
    expect(error).toBeInstanceOf(OutOfStockError);
    expect(error.productName).toBe('Cascade 45L Expedition Pack');
  });

  // REVIEW FOCUS 3: price drift between what was displayed and what is charged.
  it('refuses to charge a total different from the one shown', async () => {
    const { addToCart, getCart } = await import('@/lib/services/cart');
    const { placeOrder } = await import('@/lib/services/orders');
    const { PriceChangedError } = await import('@/lib/services/errors');
    await addToCart(browserContext(ids.alice), pack(), 1);
    const shown = (await getCart(browserContext(ids.alice))).totalCents;

    await tdb.db.update(schema.products).set({ priceCents: 50_000 })
      .where(eq(schema.products.id, pack()));

    await expect(placeOrder(browserContext(ids.alice), {
      ...(await defaultsFor(ids.alice)), expectedTotalCents: shown,
    })).rejects.toBeInstanceOf(PriceChangedError);
  });

  it('accepts a matching expected total', async () => {
    const { addToCart, getCart } = await import('@/lib/services/cart');
    const { placeOrder } = await import('@/lib/services/orders');
    await addToCart(browserContext(ids.alice), pack(), 1);
    const shown = (await getCart(browserContext(ids.alice))).totalCents;
    const order = await placeOrder(browserContext(ids.alice), {
      ...(await defaultsFor(ids.alice)), expectedTotalCents: shown,
    });
    expect(order.totalCents).toBe(shown);
  });

  it('leaves the cart intact when checkout fails', async () => {
    const { addToCart, getCart } = await import('@/lib/services/cart');
    const { placeOrder } = await import('@/lib/services/orders');
    await addToCart(browserContext(ids.alice), pack(), 1);
    await tdb.db.update(schema.products).set({ stockQty: 0 })
      .where(eq(schema.products.id, pack()));

    await placeOrder(browserContext(ids.alice), await defaultsFor(ids.alice)).catch(() => {});

    expect(await tdb.db.select().from(schema.orders)).toHaveLength(0);
    expect(await tdb.db.select().from(schema.orderItems)).toHaveLength(0);
    expect((await getCart(browserContext(ids.alice))).items).toHaveLength(1);
  });

  // REVIEW FOCUS 1: concurrent checkout must not oversell or duplicate a number.
  it('does not oversell the last unit under concurrent checkout', async () => {
    const { addToCart } = await import('@/lib/services/cart');
    const { placeOrder } = await import('@/lib/services/orders');
    await addToCart(browserContext(ids.alice), shell(), 1);
    await addToCart(browserContext(ids.carol), shell(), 1);

    const aliceDefaults = await defaultsFor(ids.alice);
    const carolDefaults = await defaultsFor(ids.carol);

    const results = await Promise.allSettled([
      placeOrder(browserContext(ids.alice), aliceDefaults),
      placeOrder(browserContext(ids.carol), carolDefaults),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

    const [product] = await tdb.db.select().from(schema.products)
      .where(eq(schema.products.id, shell()));
    expect(product.stockQty).toBe(0);
  });

  it('never issues the same order number twice under concurrency', async () => {
    const { addToCart } = await import('@/lib/services/cart');
    const { placeOrder } = await import('@/lib/services/orders');
    await addToCart(browserContext(ids.alice), mug(), 1);
    await addToCart(browserContext(ids.carol), mug(), 1);
    await addToCart(browserContext(ids.bob), mug(), 1);

    const all = await Promise.all([
      defaultsFor(ids.alice), defaultsFor(ids.carol), defaultsFor(ids.bob),
    ]);

    await Promise.allSettled([
      placeOrder(browserContext(ids.alice), all[0]),
      placeOrder(browserContext(ids.carol), all[1]),
      placeOrder(browserContext(ids.bob), all[2]),
    ]);

    const numbers = (await tdb.db.select().from(schema.orders)).map((o) => o.orderNumber);
    expect(new Set(numbers).size).toBe(numbers.length);
  });
});

describe('listOrders and getOrder', () => {
  it('lists only the requesting customer\'s orders with an item count', async () => {
    const { addToCart } = await import('@/lib/services/cart');
    const { placeOrder, listOrders } = await import('@/lib/services/orders');
    await addToCart(browserContext(ids.alice), mug(), 2);
    await placeOrder(browserContext(ids.alice), await defaultsFor(ids.alice));
    await addToCart(browserContext(ids.carol), mug(), 1);
    await placeOrder(browserContext(ids.carol), await defaultsFor(ids.carol));

    const alice = await listOrders(browserContext(ids.alice));
    expect(alice).toHaveLength(1);
    expect(alice[0].itemCount).toBe(2);
  });

  it('returns full order detail for the owner', async () => {
    const { addToCart } = await import('@/lib/services/cart');
    const { placeOrder, getOrder } = await import('@/lib/services/orders');
    await addToCart(browserContext(ids.alice), mug(), 2);
    const placed = await placeOrder(browserContext(ids.alice), await defaultsFor(ids.alice));

    const detail = await getOrder(browserContext(ids.alice), placed.orderNumber);
    expect(detail.items).toHaveLength(1);
    expect(detail.address.customerId).toBe(ids.alice);
    expect(detail.paymentMethod.last4).toBe('4242');
  });

  // OWNERSHIP — the precursor to every IDOR protection in sub-project B.
  it('refuses to return another customer\'s order', async () => {
    const { addToCart } = await import('@/lib/services/cart');
    const { placeOrder, getOrder } = await import('@/lib/services/orders');
    const { NotFoundError } = await import('@/lib/services/errors');
    await addToCart(browserContext(ids.alice), mug(), 1);
    const placed = await placeOrder(browserContext(ids.alice), await defaultsFor(ids.alice));

    await expect(getOrder(browserContext(ids.carol), placed.orderNumber))
      .rejects.toBeInstanceOf(NotFoundError);
  });

  it('treats a non-numeric order number as not found rather than throwing', async () => {
    const { getOrder } = await import('@/lib/services/orders');
    const { NotFoundError } = await import('@/lib/services/errors');
    await expect(getOrder(browserContext(ids.alice), Number('abc'))).rejects.toBeInstanceOf(NotFoundError);
  });

  it('returns an empty list for a customer with no orders', async () => {
    const { listOrders } = await import('@/lib/services/orders');
    expect(await listOrders(browserContext(ids.bob))).toEqual([]);
  });
});
