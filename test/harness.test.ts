import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { legacyCredentials } from '@/db/schema/legacy';
import { withTestDb, seedMinimal, type TestDb } from './harness';

describe('test harness', () => {
  let tdb: TestDb;
  beforeEach(async () => { tdb = await withTestDb(); });
  afterEach(async () => { await tdb.close(); });

  it('creates an isolated database with migrations applied', async () => {
    expect(await tdb.db.select().from(schema.customers)).toHaveLength(0);
  });

  it('seeds the three customers with the documented ids', async () => {
    const ids = await seedMinimal(tdb);
    expect(ids).toMatchObject({ alice: 82731, bob: 19382, carol: 44102 });
  });

  it('gives Bob no local password hash', async () => {
    await seedMinimal(tdb);
    const [bob] = await tdb.db.select().from(schema.customers)
      .where(eq(schema.customers.id, 19382));
    expect(bob.passwordHash).toBeNull();
    expect(bob.authBackend).toBe('legacy');
  });

  it('puts Bob\'s credential only in the legacy backend', async () => {
    await seedMinimal(tdb);
    const rows = await tdb.db.select().from(legacyCredentials);
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe('bob@example.com');
  });

  // Every later suite indexes productIds positionally. Pin the order here so a
  // change to insert order fails one obvious test instead of a dozen obscure ones.
  it('returns productIds in a stable pack / shell / mug order', async () => {
    const ids = await seedMinimal(tdb);
    const rows = await Promise.all(ids.productIds.map(async (id) => {
      const [p] = await tdb.db.select().from(schema.products)
        .where(eq(schema.products.id, id));
      return { slug: p.slug, priceCents: p.priceCents, stockQty: p.stockQty };
    }));
    expect(rows).toEqual([
      { slug: 'cascade-45l', priceCents: 42000, stockQty: 10 },
      { slug: 'ridgeline-shell', priceCents: 48000, stockQty: 1 },
      { slug: 'trail-mug', priceCents: 1800, stockQty: 50 },
    ]);
  });

  it('gives every customer a default address and payment method', async () => {
    const ids = await seedMinimal(tdb);
    for (const customerId of [ids.alice, ids.bob, ids.carol]) {
      const addrs = await tdb.db.select().from(schema.addresses)
        .where(eq(schema.addresses.customerId, customerId));
      const cards = await tdb.db.select().from(schema.paymentMethods)
        .where(eq(schema.paymentMethods.customerId, customerId));
      expect(addrs, `addresses for ${customerId}`).toHaveLength(1);
      expect(cards, `cards for ${customerId}`).toHaveLength(1);
    }
  });

  it('isolates databases between instances', async () => {
    const other = await withTestDb();
    await seedMinimal(tdb);
    expect(await other.db.select().from(schema.customers)).toHaveLength(0);
    await other.close();
  });
});
