import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from '@/db/schema';
import { legacyCredentials } from '@/db/schema/legacy';
import { seedCatalog } from './catalog';
import { seedCustomers } from './customers';
import { seedAccount } from './account';
import { seedOrders } from './orders';

/**
 * Rebuilds the demo database from scratch, deterministically.
 *
 * Idempotent: every run truncates first, so `pnpm db:seed` twice gives the same
 * counts rather than duplicate-key errors. That matters because the demo script
 * asks you to re-seed between runs.
 */
export async function seedAll(db: LibSQLDatabase<typeof schema>): Promise<void> {
  // Delete in foreign-key-safe order: children before parents.
  await db.delete(schema.orderItems);
  await db.delete(schema.orders);
  await db.delete(schema.cartItems);
  await db.delete(schema.carts);
  await db.delete(schema.paymentMethods);
  await db.delete(schema.addresses);
  await db.delete(schema.sessions);
  await db.delete(schema.customers);
  await db.delete(schema.products);
  await db.delete(schema.categories);
  await db.delete(legacyCredentials);

  await seedCatalog(db);
  await seedCustomers(db);
  await seedAccount(db);
  await seedOrders(db);
}

/** Summary counts, for the CLI and for a quick sanity check in a demo. */
export async function seedSummary(db: LibSQLDatabase<typeof schema>) {
  const [categories, products, customers, orders] = await Promise.all([
    db.select().from(schema.categories),
    db.select().from(schema.products),
    db.select().from(schema.customers),
    db.select().from(schema.orders),
  ]);
  return {
    categories: categories.length,
    products: products.length,
    customers: customers.length,
    orders: orders.length,
  };
}

// Running this file directly is `pnpm db:seed`. Importing it (tests) runs nothing.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!)) {
  const { db, sqlite } = await import('@/db/client');
  await seedAll(db);
  const summary = await seedSummary(db);
  sqlite.close();
  console.log(
    `seeded ${summary.categories} categories, ${summary.products} products, ` +
    `${summary.customers} customers, ${summary.orders} orders`,
  );
}
