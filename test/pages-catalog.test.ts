import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { withTestDb, seedMinimal, type TestDb } from './harness';
import { browserContext } from '@/lib/oauth/types';

let tdb: TestDb;

vi.mock('@/db/client', () => ({
  get db() {
    return (globalThis as { __testDb?: unknown }).__testDb;
  },
}));

beforeEach(async () => {
  tdb = await withTestDb();
  await seedMinimal(tdb);
  (globalThis as { __testDb?: unknown }).__testDb = tdb.db;
});

afterEach(async () => { await tdb.close(); });

describe('catalog page data', () => {
  it('returns renderable products for the landing page', async () => {
    const { searchProducts } = await import('@/lib/services/catalog');
    const { items } = await searchProducts({ perPage: 3 });
    expect(items.length).toBeGreaterThan(0);
    for (const product of items) {
      expect(product.imagePath, product.slug).toMatch(/^\/products\/.+\.webp$/);
      expect(product.name.length).toBeGreaterThan(0);
    }
  });

  it('resolves a category slug to its products', async () => {
    const { searchProducts } = await import('@/lib/services/catalog');
    expect((await searchProducts({ categorySlug: 'packs-bags' })).items.length)
      .toBeGreaterThan(0);
  });

  it('distinguishes a real but empty category from an unknown one', async () => {
    const { listCategories, searchProducts } = await import('@/lib/services/catalog');
    const known = (await listCategories()).map((c) => c.slug);
    expect(known).toContain('packs-bags');
    expect(known).not.toContain('no-such-category');
    // Both return empty; the page tells them apart by consulting listCategories.
    expect((await searchProducts({ categorySlug: 'no-such-category' })).total).toBe(0);
  });

  it('builds a category name lookup for product cards', async () => {
    const { listCategories, searchProducts } = await import('@/lib/services/catalog');
    const byId = new Map((await listCategories()).map((c) => [c.id, c.name]));
    const { items } = await searchProducts({});
    for (const product of items) {
      expect(byId.get(product.categoryId), product.slug).toBeDefined();
    }
  });
});

describe('add to cart from a product page', () => {
  it('adds the product and surfaces a service error as a message', async () => {
    const { getProductBySlug } = await import('@/lib/services/catalog');
    const { addToCart, getCart } = await import('@/lib/services/cart');
    const { ServiceError } = await import('@/lib/services/errors');

    const product = await getProductBySlug('ridgeline-shell'); // stock 1
    await addToCart(browserContext(82731), product.id, 1);
    expect((await getCart(browserContext(82731))).items).toHaveLength(1);

    // The action layer catches ServiceError and returns { error } for the form.
    const error = await addToCart(browserContext(82731), product.id, 1).catch((e) => e);
    expect(error).toBeInstanceOf(ServiceError);
    expect(error.message).toMatch(/Ridgeline 3L Hardshell/);
  });
});
