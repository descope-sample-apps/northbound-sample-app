import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

const pack = () => ids.productIds[0];  // $420.00, stock 10
const shell = () => ids.productIds[1]; // $480.00, stock 1
const mug = () => ids.productIds[2];   // $18.00,  stock 50

describe('cart service', () => {
  it('starts empty, with shipping applied and no tax', async () => {
    const { getCart } = await import('@/lib/services/cart');
    const cart = await getCart(ids.alice);
    expect(cart.items).toEqual([]);
    expect(cart.totalCents).toBe(895);
  });

  it('adds an item and computes the line total from live price', async () => {
    const { addToCart, getCart } = await import('@/lib/services/cart');
    await addToCart(ids.alice, pack(), 2);
    const cart = await getCart(ids.alice);
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0].lineTotalCents).toBe(84_000);
    expect(cart.subtotalCents).toBe(84_000);
    expect(cart.shippingCents).toBe(0);
    expect(cart.taxCents).toBe(7_140);
    expect(cart.totalCents).toBe(91_140);
  });

  it('accumulates quantity when the same product is added twice', async () => {
    const { addToCart, getCart } = await import('@/lib/services/cart');
    await addToCart(ids.alice, mug(), 2);
    await addToCart(ids.alice, mug(), 3);
    const cart = await getCart(ids.alice);
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0].quantity).toBe(5);
  });

  it('reflects a live price change without being told', async () => {
    const { addToCart, getCart } = await import('@/lib/services/cart');
    const schema = await import('@/db/schema');
    const { eq } = await import('drizzle-orm');
    await addToCart(ids.alice, mug(), 1);
    await tdb.db.update(schema.products).set({ priceCents: 2_000 })
      .where(eq(schema.products.id, mug()));
    expect((await getCart(ids.alice)).subtotalCents).toBe(2_000);
  });

  // REVIEW FOCUS 5: quantity validation at the service boundary.
  it('rejects a zero quantity', async () => {
    const { addToCart } = await import('@/lib/services/cart');
    const { ValidationError } = await import('@/lib/services/errors');
    await expect(addToCart(ids.alice, mug(), 0)).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a negative quantity', async () => {
    const { addToCart } = await import('@/lib/services/cart');
    const { ValidationError } = await import('@/lib/services/errors');
    await expect(addToCart(ids.alice, mug(), -3)).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a fractional quantity', async () => {
    const { addToCart } = await import('@/lib/services/cart');
    const { ValidationError } = await import('@/lib/services/errors');
    await expect(addToCart(ids.alice, mug(), 2.5)).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects an absurd quantity', async () => {
    const { addToCart } = await import('@/lib/services/cart');
    const { ValidationError } = await import('@/lib/services/errors');
    await expect(addToCart(ids.alice, mug(), 999_999)).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects NaN and Infinity', async () => {
    const { addToCart } = await import('@/lib/services/cart');
    const { ValidationError } = await import('@/lib/services/errors');
    await expect(addToCart(ids.alice, mug(), NaN)).rejects.toBeInstanceOf(ValidationError);
    await expect(addToCart(ids.alice, mug(), Infinity)).rejects.toBeInstanceOf(ValidationError);
  });

  it('refuses to add more than remaining stock', async () => {
    const { addToCart } = await import('@/lib/services/cart');
    const { OutOfStockError } = await import('@/lib/services/errors');
    await expect(addToCart(ids.alice, shell(), 5)).rejects.toBeInstanceOf(OutOfStockError);
  });

  it('counts what is already in the cart against stock', async () => {
    const { addToCart } = await import('@/lib/services/cart');
    const { OutOfStockError } = await import('@/lib/services/errors');
    await addToCart(ids.alice, shell(), 1);
    await expect(addToCart(ids.alice, shell(), 1)).rejects.toBeInstanceOf(OutOfStockError);
  });

  it('throws NotFoundError for an unknown product', async () => {
    const { addToCart } = await import('@/lib/services/cart');
    const { NotFoundError } = await import('@/lib/services/errors');
    await expect(addToCart(ids.alice, 999_999, 1)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('removes a line when quantity is set to zero', async () => {
    const { addToCart, updateCartItem, getCart } = await import('@/lib/services/cart');
    await addToCart(ids.alice, mug(), 3);
    await updateCartItem(ids.alice, mug(), 0);
    expect((await getCart(ids.alice)).items).toEqual([]);
  });

  it('removes a line explicitly and clears the whole cart', async () => {
    const { addToCart, removeFromCart, clearCart, getCart } =
      await import('@/lib/services/cart');
    await addToCart(ids.alice, mug(), 3);
    await addToCart(ids.alice, pack(), 1);
    await removeFromCart(ids.alice, mug());
    expect((await getCart(ids.alice)).items).toHaveLength(1);
    await clearCart(ids.alice);
    expect((await getCart(ids.alice)).items).toEqual([]);
  });

  // OWNERSHIP — the ancestor of every authorization test in this repository.
  it('keeps carts isolated between customers', async () => {
    const { addToCart, getCart } = await import('@/lib/services/cart');
    await addToCart(ids.alice, pack(), 1);
    expect((await getCart(ids.carol)).items).toEqual([]);
  });

  it('does not let one customer remove another customer\'s line', async () => {
    const { addToCart, removeFromCart, getCart } = await import('@/lib/services/cart');
    await addToCart(ids.alice, pack(), 1);
    await removeFromCart(ids.carol, pack());
    expect((await getCart(ids.alice)).items).toHaveLength(1);
  });

  it('does not let one customer change another customer\'s quantity', async () => {
    const { addToCart, updateCartItem, getCart } = await import('@/lib/services/cart');
    await addToCart(ids.alice, pack(), 1);
    await updateCartItem(ids.carol, pack(), 5);
    expect((await getCart(ids.alice)).items[0].quantity).toBe(1);
  });

  it('surfaces stock and active state on each line so checkout can warn early', async () => {
    const { addToCart, getCart } = await import('@/lib/services/cart');
    await addToCart(ids.alice, shell(), 1);
    const [line] = (await getCart(ids.alice)).items;
    expect(line.stockQty).toBe(1);
    expect(line.isActive).toBe(true);
  });
});
