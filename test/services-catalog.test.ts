import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { withTestDb, seedMinimal, type TestDb } from './harness';

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

describe('catalog service', () => {
  it('lists categories', async () => {
    const { listCategories } = await import('@/lib/services/catalog');
    expect((await listCategories()).map((c) => c.slug)).toEqual(['packs-bags']);
  });

  it('returns a product by slug', async () => {
    const { getProductBySlug } = await import('@/lib/services/catalog');
    expect((await getProductBySlug('cascade-45l')).name)
      .toBe('Cascade 45L Expedition Pack');
  });

  it('throws NotFoundError for an unknown slug', async () => {
    const { getProductBySlug } = await import('@/lib/services/catalog');
    const { NotFoundError } = await import('@/lib/services/errors');
    await expect(getProductBySlug('no-such-product')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('will not return an inactive product by slug', async () => {
    await tdb.db.update(schema.products).set({ isActive: false })
      .where(eq(schema.products.slug, 'trail-mug'));
    const { getProductBySlug } = await import('@/lib/services/catalog');
    const { NotFoundError } = await import('@/lib/services/errors');
    await expect(getProductBySlug('trail-mug')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('searches by free text, case-insensitively', async () => {
    const { searchProducts } = await import('@/lib/services/catalog');
    expect((await searchProducts({ q: 'CASCADE' })).items.map((p) => p.slug))
      .toEqual(['cascade-45l']);
  });

  it('filters by price range', async () => {
    const { searchProducts } = await import('@/lib/services/catalog');
    expect((await searchProducts({ maxCents: 2000 })).items.map((p) => p.slug))
      .toEqual(['trail-mug']);
  });

  it('sorts by price ascending and descending', async () => {
    const { searchProducts } = await import('@/lib/services/catalog');
    expect((await searchProducts({ sort: 'price-asc' })).items[0].slug).toBe('trail-mug');
    expect((await searchProducts({ sort: 'price-desc' })).items[0].slug).toBe('ridgeline-shell');
  });

  it('excludes inactive products from search', async () => {
    await tdb.db.update(schema.products).set({ isActive: false })
      .where(eq(schema.products.slug, 'trail-mug'));
    const { searchProducts } = await import('@/lib/services/catalog');
    expect((await searchProducts({})).items.map((p) => p.slug)).not.toContain('trail-mug');
  });

  it('paginates and reports the unpaginated total', async () => {
    const { searchProducts } = await import('@/lib/services/catalog');
    const page1 = await searchProducts({ perPage: 2, page: 1 });
    expect(page1.items).toHaveLength(2);
    expect(page1.total).toBe(3);
  });

  it('returns an empty result rather than throwing for an unknown category', async () => {
    const { searchProducts } = await import('@/lib/services/catalog');
    expect(await searchProducts({ categorySlug: 'no-such-category' }))
      .toEqual({ items: [], total: 0 });
  });

  it('rejects a nonsensical page number instead of returning a negative offset', async () => {
    const { searchProducts } = await import('@/lib/services/catalog');
    const { ValidationError } = await import('@/lib/services/errors');
    await expect(searchProducts({ page: 0 })).rejects.toBeInstanceOf(ValidationError);
    await expect(searchProducts({ perPage: -5 })).rejects.toBeInstanceOf(ValidationError);
  });

  it('treats a free-text search with SQL wildcards as literal text', async () => {
    const { searchProducts } = await import('@/lib/services/catalog');
    // '%' must match nothing rather than acting as "match everything".
    expect((await searchProducts({ q: '%' })).items).toEqual([]);
  });
});
