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
  const [card] = await tdb.db.select().from(schema.paymentMethods)
    .where(eq(schema.paymentMethods.customerId, customerId));
  return { addressId: address.id, paymentMethodId: card.id };
}

const mug = () => ids.productIds[2];  // $18.00, stock 50 — no contention
const pack = () => ids.productIds[0]; // $420.00, stock 10

describe('concurrent checkout with no contended row', () => {
  // SQLite allows one writer at a time. Three customers buying from a stock of
  // 50 contend for nothing at all, but they do contend for the write lock, and
  // the loser must not receive a raw driver error.
  it('lets three unrelated customers check out at the same time', async () => {
    const { addToCart } = await import('@/lib/services/cart');
    const { placeOrder } = await import('@/lib/services/orders');

    await addToCart(browserContext(ids.alice), mug(), 1);
    await addToCart(browserContext(ids.carol), mug(), 1);
    await addToCart(browserContext(ids.bob), mug(), 1);

    const [a, c, b] = await Promise.all([
      defaultsFor(ids.alice), defaultsFor(ids.carol), defaultsFor(ids.bob),
    ]);

    const results = await Promise.allSettled([
      placeOrder(browserContext(ids.alice), a),
      placeOrder(browserContext(ids.carol), c),
      placeOrder(browserContext(ids.bob), b),
    ]);

    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected.map((r) => (r as PromiseRejectedResult).reason?.message ?? ''))
      .toEqual([]);

    const [product] = await tdb.db.select().from(schema.products)
      .where(eq(schema.products.id, mug()));
    expect(product.stockQty).toBe(47);
  });

  // If a lock genuinely cannot be acquired, the caller must still see a typed
  // ServiceError — a raw LibsqlError escapes the service layer's contract and
  // reaches the customer as an unhandled crash.
  it('never lets a raw driver error escape placeOrder', async () => {
    const { addToCart } = await import('@/lib/services/cart');
    const { placeOrder } = await import('@/lib/services/orders');
    const { ServiceError } = await import('@/lib/services/errors');

    for (const customerId of [ids.alice, ids.carol, ids.bob]) {
      await addToCart(browserContext(customerId), pack(), 1);
    }
    const defaults = await Promise.all(
      [ids.alice, ids.carol, ids.bob].map((id) => defaultsFor(id)),
    );

    const results = await Promise.allSettled([
      placeOrder(browserContext(ids.alice), defaults[0]),
      placeOrder(browserContext(ids.carol), defaults[1]),
      placeOrder(browserContext(ids.bob), defaults[2]),
    ]);

    for (const result of results) {
      if (result.status === 'rejected') {
        expect(result.reason, String(result.reason)).toBeInstanceOf(ServiceError);
      }
    }
  });
});

describe('deleting account details a past order depends on', () => {
  it('refuses to delete an address used by an order, with a readable message', async () => {
    const { addToCart } = await import('@/lib/services/cart');
    const { placeOrder } = await import('@/lib/services/orders');
    const { deleteAddress, listAddresses } = await import('@/lib/services/addresses');
    const { ServiceError } = await import('@/lib/services/errors');

    const defaults = await defaultsFor(ids.alice);
    await addToCart(browserContext(ids.alice), mug(), 1);
    await placeOrder(browserContext(ids.alice), defaults);

    const error = await deleteAddress(browserContext(ids.alice), defaults.addressId).catch((e) => e);
    expect(error).toBeInstanceOf(ServiceError);
    expect(error.message).toMatch(/past orders|previous orders|used by/i);

    // And it is still there — a failed delete must not half-happen.
    expect(await listAddresses(browserContext(ids.alice))).toHaveLength(1);
  });

  it('refuses to delete a payment method used by an order', async () => {
    const { addToCart } = await import('@/lib/services/cart');
    const { placeOrder } = await import('@/lib/services/orders');
    const { deletePaymentMethod, listPaymentMethods } =
      await import('@/lib/services/paymentMethods');
    const { ServiceError } = await import('@/lib/services/errors');

    const defaults = await defaultsFor(ids.alice);
    await addToCart(browserContext(ids.alice), mug(), 1);
    await placeOrder(browserContext(ids.alice), defaults);

    const error = await deletePaymentMethod(browserContext(ids.alice), defaults.paymentMethodId)
      .catch((e) => e);
    expect(error).toBeInstanceOf(ServiceError);
    expect(error.message).toMatch(/past orders|previous orders|used by/i);
    expect(await listPaymentMethods(browserContext(ids.alice))).toHaveLength(1);
  });

  it('still deletes an address no order references', async () => {
    const { upsertAddress, deleteAddress, listAddresses } =
      await import('@/lib/services/addresses');
    const created = await upsertAddress(browserContext(ids.alice), {
      label: 'Work', recipient: 'Alice Chen', line1: '2 Office Way',
      city: 'Portland', region: 'OR', postalCode: '97202',
    });
    await deleteAddress(browserContext(ids.alice), created.id);
    expect((await listAddresses(browserContext(ids.alice))).map((a) => a.id)).not.toContain(created.id);
  });
});

describe('cart creation is safe under concurrent first access', () => {
  // The root layout's Nav calls getCart while the page body calls it again, so
  // a customer whose first authenticated page load is /cart makes two
  // simultaneous getOrCreateCart calls against a UNIQUE customer_id.
  it('survives three simultaneous first reads of an empty cart', async () => {
    const { getCart } = await import('@/lib/services/cart');

    // Seeded customers have no cart row until something creates one.
    expect(await tdb.db.select().from(schema.carts)).toHaveLength(0);

    const results = await Promise.allSettled([
      getCart(browserContext(ids.alice)), getCart(browserContext(ids.alice)), getCart(browserContext(ids.alice)),
    ]);

    expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
    const carts = await tdb.db.select().from(schema.carts)
      .where(eq(schema.carts.customerId, ids.alice));
    expect(carts).toHaveLength(1);
  });
});

describe('stock decrement is atomic', () => {
  it('never drives stock negative', async () => {
    const { addToCart } = await import('@/lib/services/cart');
    const { placeOrder } = await import('@/lib/services/orders');

    await addToCart(browserContext(ids.alice), pack(), 10); // exactly all of it
    await placeOrder(browserContext(ids.alice), await defaultsFor(ids.alice));

    const [product] = await tdb.db.select().from(schema.products)
      .where(eq(schema.products.id, pack()));
    expect(product.stockQty).toBe(0);
  });

  it('decrements relative to the stored value rather than a read-then-write', async () => {
    const { addToCart } = await import('@/lib/services/cart');
    const { placeOrder } = await import('@/lib/services/orders');
    const { readFileSync } = await import('node:fs');

    await addToCart(browserContext(ids.alice), pack(), 2);
    await placeOrder(browserContext(ids.alice), await defaultsFor(ids.alice));

    const [product] = await tdb.db.select().from(schema.products)
      .where(eq(schema.products.id, pack()));
    expect(product.stockQty).toBe(8);

    // The guard that makes this safe on an engine without SQLite's single-writer
    // lock is the relative UPDATE, not the JS arithmetic. Pin it.
    const source = readFileSync('lib/services/orders.ts', 'utf8');
    expect(source).not.toMatch(/stockQty:\s*product\.stockQty\s*-/);
  });
});
