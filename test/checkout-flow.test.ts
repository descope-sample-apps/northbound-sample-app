import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { withTestDb, seedMinimal, type TestDb } from './harness';

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
  const [card] = await tdb.db.select().from(schema.paymentMethods)
    .where(eq(schema.paymentMethods.customerId, customerId));
  return { addressId: address.id, paymentMethodId: card.id };
}

describe('browse to order', () => {
  it('completes the whole path and leaves consistent state', async () => {
    const { getProductBySlug } = await import('@/lib/services/catalog');
    const { addToCart, getCart } = await import('@/lib/services/cart');
    const { placeOrder, getOrder, listOrders } = await import('@/lib/services/orders');

    const product = await getProductBySlug('cascade-45l');
    await addToCart(ids.alice, product.id, 2);

    const cart = await getCart(ids.alice);
    expect(cart.totalCents).toBe(91_140);

    const order = await placeOrder(ids.alice, {
      ...(await defaultsFor(ids.alice)),
      expectedTotalCents: cart.totalCents,
    });

    expect(order.totalCents).toBe(cart.totalCents);
    expect((await getCart(ids.alice)).items).toEqual([]);
    expect(await listOrders(ids.alice)).toHaveLength(1);

    const detail = await getOrder(ids.alice, order.orderNumber);
    expect(detail.items[0].nameSnapshot).toBe('Cascade 45L Expedition Pack');
    expect(detail.address.customerId).toBe(ids.alice);

    const [after] = await tdb.db.select().from(schema.products)
      .where(eq(schema.products.id, product.id));
    expect(after.stockQty).toBe(8);
  });

  it('does not let another customer read the confirmation', async () => {
    const { addToCart } = await import('@/lib/services/cart');
    const { placeOrder, getOrder } = await import('@/lib/services/orders');
    const { NotFoundError } = await import('@/lib/services/errors');

    await addToCart(ids.alice, ids.productIds[2], 1);
    const order = await placeOrder(ids.alice, await defaultsFor(ids.alice));

    await expect(getOrder(ids.carol, order.orderNumber))
      .rejects.toBeInstanceOf(NotFoundError);
  });

  it('charges the total the customer was shown, including shipping under $75', async () => {
    const { addToCart, getCart } = await import('@/lib/services/cart');
    const { placeOrder } = await import('@/lib/services/orders');

    await addToCart(ids.alice, ids.productIds[2], 1); // $18.00 mug
    const cart = await getCart(ids.alice);
    expect(cart.shippingCents).toBe(895);

    const order = await placeOrder(ids.alice, {
      ...(await defaultsFor(ids.alice)),
      expectedTotalCents: cart.totalCents,
    });
    expect(order.totalCents).toBe(cart.totalCents);
    expect(order.shippingCents).toBe(895);
  });

  it('keeps the snapshot after the catalog price later changes', async () => {
    const { addToCart } = await import('@/lib/services/cart');
    const { placeOrder, getOrder } = await import('@/lib/services/orders');

    await addToCart(ids.alice, ids.productIds[0], 1);
    const order = await placeOrder(ids.alice, await defaultsFor(ids.alice));

    await tdb.db.update(schema.products).set({ priceCents: 1 })
      .where(eq(schema.products.id, ids.productIds[0]));

    const detail = await getOrder(ids.alice, order.orderNumber);
    expect(detail.items[0].unitPriceCents).toBe(42_000);
    expect(detail.totalCents).toBe(order.totalCents);
  });
});
