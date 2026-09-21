import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import * as schema from '@/db/schema';
import { withTestDb, type TestDb } from './harness';
import { CATEGORIES, PRODUCTS, PRICE_BANDS, seedCatalog } from '@/db/seed/catalog';
import { PHOTO_IDS } from '@/db/seed/images';

describe('catalog seed data', () => {
  it('defines exactly 8 categories', () => {
    expect(CATEGORIES).toHaveLength(8);
  });

  it('defines exactly 64 products', () => {
    expect(PRODUCTS).toHaveLength(64);
  });

  it('puts 8 products in every category', () => {
    for (const c of CATEGORIES) {
      expect(PRODUCTS.filter((p) => p.categorySlug === c.slug), c.slug).toHaveLength(8);
    }
  });

  it('gives every product a unique SKU and slug', () => {
    expect(new Set(PRODUCTS.map((p) => p.sku)).size).toBe(64);
    expect(new Set(PRODUCTS.map((p) => p.slug)).size).toBe(64);
  });

  it('prices every product inside its category band', () => {
    for (const p of PRODUCTS) {
      const [min, max] = PRICE_BANDS[p.categorySlug];
      expect(p.priceCents, p.slug).toBeGreaterThanOrEqual(min);
      expect(p.priceCents, p.slug).toBeLessThanOrEqual(max);
    }
  });

  // The project's approval demo needs an agent to request a ~$900 checkout.
  // That has to be a plausible basket, not a stunt quantity of one cheap item.
  it('can build a $900 basket from two items', () => {
    const top = PRODUCTS.map((p) => p.priceCents).sort((a, b) => b - a);
    expect(top[0] + top[1]).toBeGreaterThanOrEqual(90_000);
  });

  it('puts a meaningful number of products on each side of the $100 policy line', () => {
    const under = PRODUCTS.filter((p) => p.priceCents < 10_000).length;
    const over = PRODUCTS.filter((p) => p.priceCents >= 10_000).length;
    expect(under).toBeGreaterThanOrEqual(10);
    expect(over).toBeGreaterThanOrEqual(10);
  });

  it('stocks every product', () => {
    for (const p of PRODUCTS) expect(p.stockQty, p.slug).toBeGreaterThan(0);
  });

  it('writes a real description for every product', () => {
    for (const p of PRODUCTS) expect(p.description.length, p.slug).toBeGreaterThan(30);
  });

  it('pins a distinct photo id for every product', () => {
    for (const p of PRODUCTS) expect(PHOTO_IDS, p.slug).toHaveProperty(p.slug);
    const ids = PRODUCTS.map((p) => PHOTO_IDS[p.slug]);
    expect(new Set(ids).size, 'photo ids must not repeat across SKUs').toBe(64);
  });

  it('has a committed image file for every product', () => {
    const missing = PRODUCTS
      .filter((p) => !existsSync(`public/products/${p.slug}.webp`))
      .map((p) => p.slug);
    expect(missing).toEqual([]);
  });
});

describe('seedCatalog', () => {
  let tdb: TestDb;
  beforeEach(async () => { tdb = await withTestDb(); });
  afterEach(async () => { await tdb.close(); });

  it('inserts all categories and products with resolved image paths', async () => {
    await seedCatalog(tdb.db);
    expect(await tdb.db.select().from(schema.categories)).toHaveLength(8);

    const products = await tdb.db.select().from(schema.products);
    expect(products).toHaveLength(64);
    expect(products.every((p) => p.imagePath.startsWith('/products/'))).toBe(true);
    expect(products.every((p) => p.categoryId > 0)).toBe(true);
    expect(products.every((p) => p.isActive)).toBe(true);
  });
});
