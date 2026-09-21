import { createClient, type Client } from '@libsql/client';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import * as schema from '@/db/schema';
import { legacyCredentials } from '@/db/schema/legacy';
import { hashPassword } from '@/lib/auth/password';

export type TestDb = {
  db: LibSQLDatabase<typeof schema>;
  sqlite: Client;
  close: () => Promise<void>;
};

/**
 * A fresh in-memory database with migrations applied.
 *
 * Every required test in sub-projects B through E — bearer-only enforcement,
 * PKCE, audience validation, ID-JAG issuer validation, the policy truth table,
 * linking surviving an email change — is expected to run on this harness, so
 * it is deliberately a little over-built for what sub-project A needs.
 */
export async function withTestDb(): Promise<TestDb> {
  const sqlite = createClient({ url: ':memory:' });
  const db = drizzle(sqlite, { schema });
  await migrate(db, { migrationsFolder: './drizzle' });
  return {
    db,
    sqlite,
    close: async () => { sqlite.close(); },
  };
}

/**
 * The smallest seed every service test can share: the three documented
 * customers, one category, three products chosen to exercise distinct paths,
 * and one default address and payment method each.
 *
 * The three products are fixed and their order is pinned by a harness test:
 *   [0] cascade-45l     $420.00  stock 10  — ordinary case, over free shipping
 *   [1] ridgeline-shell $480.00  stock  1  — the last-unit contention case
 *   [2] trail-mug        $18.00  stock 50  — under the free-shipping threshold
 */
export async function seedMinimal(tdb: TestDb) {
  const { db } = tdb;
  const now = new Date();
  const localHash = await hashPassword('password123');

  await db.insert(schema.customers).values([
    {
      id: 82731, email: 'alice@example.com', name: 'Alice Chen',
      emailVerified: true, passwordHash: localHash, authBackend: 'local',
      signupOrigin: 'web', passwordSetAt: now, createdAt: now,
    },
    {
      // No local hash at all. Bob's credential lives in the legacy backend.
      id: 19382, email: 'bob@example.com', name: 'Bob Ferreira',
      emailVerified: false, passwordHash: null, authBackend: 'legacy',
      signupOrigin: 'web', passwordSetAt: null, createdAt: now,
    },
    {
      id: 44102, email: 'carol@example.com', name: 'Carol Nwosu',
      emailVerified: true, passwordHash: localHash, authBackend: 'local',
      signupOrigin: 'google', passwordSetAt: now, createdAt: now,
    },
  ]);

  await db.insert(legacyCredentials).values({
    legacyUserId: 5501,
    email: 'bob@example.com',
    passwordHash: await hashPassword('legacy-pass-2019'),
    createdAt: now,
  });

  const [category] = await db.insert(schema.categories).values({
    slug: 'packs-bags', name: 'Packs & Bags',
    description: 'Carry systems.', sortOrder: 1,
  }).returning();

  const products = await db.insert(schema.products).values([
    {
      sku: 'NB-TST-001', slug: 'cascade-45l', name: 'Cascade 45L Expedition Pack',
      description: 'A 45-litre haul bag.', categoryId: category.id,
      priceCents: 42000, imagePath: '/products/cascade-45l.webp',
      stockQty: 10, isActive: true, createdAt: now,
    },
    {
      sku: 'NB-TST-002', slug: 'ridgeline-shell', name: 'Ridgeline 3L Hardshell',
      description: 'Three-layer waterproof shell.', categoryId: category.id,
      priceCents: 48000, imagePath: '/products/ridgeline-shell.webp',
      stockQty: 1, isActive: true, createdAt: now,
    },
    {
      sku: 'NB-TST-003', slug: 'trail-mug', name: 'Trail Enamel Mug',
      description: 'Twelve ounces.', categoryId: category.id,
      priceCents: 1800, imagePath: '/products/trail-mug.webp',
      stockQty: 50, isActive: true, createdAt: now,
    },
  ]).returning();

  for (const customerId of [82731, 19382, 44102]) {
    await db.insert(schema.addresses).values({
      customerId, label: 'Home', recipient: 'Test Recipient',
      line1: '1 Test Street', city: 'Portland', region: 'OR',
      postalCode: '97201', country: 'US', isDefault: true, createdAt: now,
    });
    await db.insert(schema.paymentMethods).values({
      customerId, brand: 'visa', last4: '4242', expMonth: 6, expYear: 2030,
      holderName: 'Test Holder', isDefault: true, createdAt: now,
    });
  }

  return {
    alice: 82731,
    bob: 19382,
    carol: 44102,
    categoryId: category.id,
    productIds: products.map((p) => p.id),
  };
}
