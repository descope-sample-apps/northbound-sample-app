import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { withTestDb, seedMinimal, type TestDb } from './harness';
import { carts } from '@/db/schema';

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

const GUEST = 'guest-token-1';

describe('a cart without an account', () => {
  it('holds items against a token', async () => {
    const { addToCart, getCart } = await import('@/lib/services/cart');

    await addToCart({ token: GUEST }, ids.productIds[0], 2);

    const cart = await getCart({ token: GUEST });
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0].quantity).toBe(2);
  });

  // The whole point of the separation: two owners, two carts.
  it('is not visible to a customer, and theirs is not visible to it', async () => {
    const { addToCart, getCart } = await import('@/lib/services/cart');

    await addToCart({ token: GUEST }, ids.productIds[0], 2);
    await addToCart({ customerId: ids.alice }, ids.productIds[2], 1);

    expect((await getCart({ token: GUEST })).items[0].productId).toBe(ids.productIds[0]);
    expect((await getCart({ customerId: ids.alice })).items[0].productId).toBe(ids.productIds[2]);
  });

  // A visitor who only browses should cost nothing. No owner, no row.
  it('writes no row for a visitor who has added nothing', async () => {
    const { getCart } = await import('@/lib/services/cart');

    const { calcTotals } = await import('@/lib/money');

    const cart = await getCart(null);

    expect(cart.items).toEqual([]);
    // The same view an empty cart has always produced — flat shipping and all.
    expect(cart).toEqual({ items: [], ...calcTotals(0) });
    expect(await tdb.db.select().from(carts)).toEqual([]);
  });
});

describe('adopting a guest cart at sign-in', () => {
  it('moves the lines onto the customer and deletes the guest cart', async () => {
    const { addToCart, getCart, adoptGuestCart } = await import('@/lib/services/cart');

    await addToCart({ token: GUEST }, ids.productIds[0], 2);
    await adoptGuestCart(GUEST, ids.alice);

    expect((await getCart({ customerId: ids.alice })).items[0].quantity).toBe(2);
    expect(await tdb.db.select().from(carts).where(eq(carts.token, GUEST))).toEqual([]);
  });

  it('adds quantities when the same product is in both carts', async () => {
    const { addToCart, getCart, adoptGuestCart } = await import('@/lib/services/cart');

    await addToCart({ customerId: ids.alice }, ids.productIds[2], 3);
    await addToCart({ token: GUEST }, ids.productIds[2], 4);

    await adoptGuestCart(GUEST, ids.alice);

    const cart = await getCart({ customerId: ids.alice });
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0].quantity).toBe(7);
  });

  // Stock can move while a cart sits in a browser. Capping is the only answer that
  // neither oversells nor throws away what they chose.
  it('caps a merged line at what is left in stock', async () => {
    const { addToCart, getCart, adoptGuestCart } = await import('@/lib/services/cart');

    // Ridgeline has stockQty 1.
    await addToCart({ customerId: ids.alice }, ids.productIds[1], 1);
    await addToCart({ token: GUEST }, ids.productIds[1], 1);

    await adoptGuestCart(GUEST, ids.alice);

    expect((await getCart({ customerId: ids.alice })).items[0].quantity).toBe(1);
  });

  it('drops a product that has been withdrawn, keeping the rest', async () => {
    const { addToCart, getCart, adoptGuestCart } = await import('@/lib/services/cart');
    const { products } = await import('@/db/schema');

    await addToCart({ token: GUEST }, ids.productIds[0], 1);
    await addToCart({ token: GUEST }, ids.productIds[2], 1);
    await tdb.db.update(products).set({ isActive: false }).where(eq(products.id, ids.productIds[0]));

    await adoptGuestCart(GUEST, ids.alice);

    const cart = await getCart({ customerId: ids.alice });
    expect(cart.items.map((line) => line.productId)).toEqual([ids.productIds[2]]);
  });

  // Signing in on a browser that never had a cart is the common case.
  it('does nothing for a token with no cart', async () => {
    const { adoptGuestCart, getCart } = await import('@/lib/services/cart');

    await expect(adoptGuestCart('never-used', ids.alice)).resolves.toBeUndefined();
    expect((await getCart({ customerId: ids.alice })).items).toEqual([]);
  });

  it('leaves another customer untouched', async () => {
    const { addToCart, getCart, adoptGuestCart } = await import('@/lib/services/cart');

    await addToCart({ customerId: ids.bob }, ids.productIds[2], 5);
    await addToCart({ token: GUEST }, ids.productIds[0], 1);

    await adoptGuestCart(GUEST, ids.alice);

    const bob = await getCart({ customerId: ids.bob });
    expect(bob.items).toHaveLength(1);
    expect(bob.items[0].quantity).toBe(5);
  });
});
