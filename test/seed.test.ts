import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { legacyCredentials } from '@/db/schema/legacy';
import { withTestDb, type TestDb } from './harness';

let tdb: TestDb;

vi.mock('@/db/client', () => ({
  get db() {
    return (globalThis as { __testDb?: unknown }).__testDb;
  },
}));

beforeEach(async () => {
  tdb = await withTestDb();
  (globalThis as { __testDb?: unknown }).__testDb = tdb.db;
  const { seedAll } = await import('@/db/seed/index');
  await seedAll(tdb.db);
});

afterEach(async () => { await tdb.close(); });

describe('full seed', () => {
  it('creates 64 products across 8 categories', async () => {
    expect(await tdb.db.select().from(schema.products)).toHaveLength(64);
    expect(await tdb.db.select().from(schema.categories)).toHaveLength(8);
  });

  it('creates the three documented customers', async () => {
    const rows = await tdb.db.select().from(schema.customers);
    expect(rows.map((c) => c.id).sort((a, b) => a - b)).toEqual([19382, 44102, 82731]);
  });

  it('leaves Bob unverified with no local password hash', async () => {
    const [bob] = await tdb.db.select().from(schema.customers)
      .where(eq(schema.customers.id, 19382));
    expect(bob.passwordHash).toBeNull();
    expect(bob.emailVerified).toBe(false);
    expect(bob.authBackend).toBe('legacy');
    expect(bob.createdAt.getFullYear()).toBe(2019);
  });

  it('puts Bob\'s credential in the legacy backend only', async () => {
    const rows = await tdb.db.select().from(legacyCredentials);
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe('bob@example.com');
  });

  it('records Carol as a Google signup who set a password later', async () => {
    const [carol] = await tdb.db.select().from(schema.customers)
      .where(eq(schema.customers.id, 44102));
    expect(carol.signupOrigin).toBe('google');
    expect(carol.passwordSetAt).not.toBeNull();
    expect(carol.passwordSetAt!.getTime()).toBeGreaterThan(carol.createdAt.getTime());
  });

  it('lets each seeded customer log in with their documented password', async () => {
    const { verifyCredentials } = await import('@/lib/auth/verify');
    process.env.LEGACY_AUTH_SERVICE_TOKEN = 'test-token';
    for (const [email, password, id] of [
      ['alice@example.com', 'alpine-trail-2019', 82731],
      ['bob@example.com', 'northbound-legacy-99', 19382],
      ['carol@example.com', 'summit-ridge-4410', 44102],
    ] as const) {
      expect(await verifyCredentials(email, password), email)
        .toEqual({ ok: true, customerId: id });
    }
  });

  it('seeds 16 orders numbered 10225 to 10240', async () => {
    const rows = await tdb.db.select().from(schema.orders);
    expect(rows).toHaveLength(16);
    const numbers = rows.map((o) => o.orderNumber).sort((a, b) => a - b);
    expect(numbers[0]).toBe(10_225);
    expect(numbers[15]).toBe(10_240);
    expect(new Set(numbers).size).toBe(16);
  });

  it('makes the next order placed number 10241', async () => {
    const { addToCart } = await import('@/lib/services/cart');
    const { placeOrder } = await import('@/lib/services/orders');
    const [address] = await tdb.db.select().from(schema.addresses)
      .where(eq(schema.addresses.customerId, 82731));
    const [card] = await tdb.db.select().from(schema.paymentMethods)
      .where(eq(schema.paymentMethods.customerId, 82731));
    const [product] = await tdb.db.select().from(schema.products).limit(1);

    await addToCart(82731, product.id, 1);
    const order = await placeOrder(82731, {
      addressId: address.id, paymentMethodId: card.id,
    });
    expect(order.orderNumber).toBe(10_241);
  });

  it('distributes orders 8 / 5 / 3 across Alice, Carol and Bob', async () => {
    const rows = await tdb.db.select().from(schema.orders);
    const count = (id: number) => rows.filter((o) => o.customerId === id).length;
    expect([count(82731), count(44102), count(19382)]).toEqual([8, 5, 3]);
  });

  it('shows more than one order status', async () => {
    const rows = await tdb.db.select().from(schema.orders);
    expect(new Set(rows.map((o) => o.status)).size).toBeGreaterThan(1);
  });

  it('places every seeded order within the last six months', async () => {
    const sixMonthsAgo = Date.now() - 1000 * 60 * 60 * 24 * 190;
    for (const order of await tdb.db.select().from(schema.orders)) {
      expect(order.placedAt.getTime()).toBeGreaterThan(sixMonthsAgo);
      expect(order.placedAt.getTime()).toBeLessThanOrEqual(Date.now());
    }
  });

  it('computes seeded order totals with the same money rules as checkout', async () => {
    const { calcTotals } = await import('@/lib/money');
    for (const order of await tdb.db.select().from(schema.orders)) {
      const expected = calcTotals(order.subtotalCents);
      expect({
        shipping: order.shippingCents, tax: order.taxCents, total: order.totalCents,
      }, `order ${order.orderNumber}`).toEqual({
        shipping: expected.shippingCents, tax: expected.taxCents, total: expected.totalCents,
      });
    }
  });

  it('gives every order at least one line item with a snapshot', async () => {
    const orders = await tdb.db.select().from(schema.orders);
    const items = await tdb.db.select().from(schema.orderItems);
    expect(items.length).toBeGreaterThanOrEqual(orders.length);
    for (const item of items) {
      expect(item.nameSnapshot.length).toBeGreaterThan(0);
      expect(item.lineTotalCents).toBe(item.unitPriceCents * item.quantity);
    }
  });

  it('does not spend stock on historical orders', async () => {
    // Seeded history is not current demand. Every product should still be in stock.
    const products = await tdb.db.select().from(schema.products);
    expect(products.every((p) => p.stockQty > 0)).toBe(true);
  });

  it('gives Alice two addresses and two cards, and the others one each', async () => {
    const counts = async (table: typeof schema.addresses | typeof schema.paymentMethods) => {
      const rows = await tdb.db.select().from(table);
      return [82731, 44102, 19382].map(
        (id) => rows.filter((r) => r.customerId === id).length);
    };
    expect(await counts(schema.addresses)).toEqual([2, 1, 1]);
    expect(await counts(schema.paymentMethods)).toEqual([2, 1, 1]);
  });

  it('is idempotent — running it twice yields the same counts', async () => {
    const { seedAll } = await import('@/db/seed/index');
    await seedAll(tdb.db);
    expect(await tdb.db.select().from(schema.products)).toHaveLength(64);
    expect(await tdb.db.select().from(schema.customers)).toHaveLength(3);
    expect(await tdb.db.select().from(schema.orders)).toHaveLength(16);
  });
});
