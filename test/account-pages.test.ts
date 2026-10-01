import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

describe('account page data', () => {
  it('shows Bob as unverified and Alice as verified', async () => {
    const { getProfile } = await import('@/lib/services/profile');
    expect((await getProfile(browserContext(ids.bob))).emailVerified).toBe(false);
    expect((await getProfile(browserContext(ids.alice))).emailVerified).toBe(true);
  });

  it('returns an empty order list for a customer with no orders', async () => {
    const { listOrders } = await import('@/lib/services/orders');
    expect(await listOrders(browserContext(ids.bob))).toEqual([]);
  });
});

describe('order detail route params', () => {
  it('treats a non-numeric order number as not found', async () => {
    const { getOrder } = await import('@/lib/services/orders');
    const { NotFoundError } = await import('@/lib/services/errors');
    await expect(getOrder(browserContext(ids.alice), Number('abc'))).rejects.toBeInstanceOf(NotFoundError);
  });

  it('treats a negative or fractional order number as not found', async () => {
    const { getOrder } = await import('@/lib/services/orders');
    const { NotFoundError } = await import('@/lib/services/errors');
    await expect(getOrder(browserContext(ids.alice), -1)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getOrder(browserContext(ids.alice), 1.5)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('treats an order number from another customer as not found', async () => {
    const { addToCart } = await import('@/lib/services/cart');
    const { placeOrder, getOrder } = await import('@/lib/services/orders');
    const { NotFoundError } = await import('@/lib/services/errors');
    const schema = await import('@/db/schema');
    const { eq } = await import('drizzle-orm');

    const [address] = await tdb.db.select().from(schema.addresses)
      .where(eq(schema.addresses.customerId, ids.alice));
    const [card] = await tdb.db.select().from(schema.paymentMethods)
      .where(eq(schema.paymentMethods.customerId, ids.alice));

    await addToCart(browserContext(ids.alice), ids.productIds[2], 1);
    const order = await placeOrder(browserContext(ids.alice), {
      addressId: address.id, paymentMethodId: card.id,
    });

    await expect(getOrder(browserContext(ids.bob), order.orderNumber))
      .rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('account mutations stay scoped to the signed-in customer', () => {
  it('deleting the last address leaves other customers untouched', async () => {
    const { listAddresses, deleteAddress } = await import('@/lib/services/addresses');
    const [aliceAddress] = await listAddresses(browserContext(ids.alice));
    await deleteAddress(browserContext(ids.alice), aliceAddress.id);
    expect(await listAddresses(browserContext(ids.alice))).toEqual([]);
    expect(await listAddresses(browserContext(ids.carol))).toHaveLength(1);
  });

  it('renaming a profile does not touch another customer', async () => {
    const { getProfile, updateProfile } = await import('@/lib/services/profile');
    await updateProfile(browserContext(ids.alice), { name: 'Renamed' });
    expect((await getProfile(browserContext(ids.alice))).name).toBe('Renamed');
    expect((await getProfile(browserContext(ids.carol))).name).toBe('Carol Nwosu');
  });
});
