import { asc, eq } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from '@/db/schema';
import { calcTotals } from '@/lib/money';
import { ALICE_ID, BOB_ID, CAROL_ID } from './customers';

export const FIRST_SEEDED_ORDER_NUMBER = 10_225;
export const SEEDED_ORDER_COUNT = 16;

/**
 * Who placed which order. Eight for Alice, five for Carol, three for Bob —
 * interleaved rather than blocked, so the order list looks like three people
 * shopping rather than three batches.
 */
const ORDER_OWNERS = [
  ALICE_ID, CAROL_ID, ALICE_ID, BOB_ID, ALICE_ID, CAROL_ID, ALICE_ID, ALICE_ID,
  CAROL_ID, ALICE_ID, BOB_ID, CAROL_ID, ALICE_ID, CAROL_ID, BOB_ID, ALICE_ID,
];

/**
 * A tiny linear congruential generator. Seeded history has to be identical on
 * every clone — `pnpm db:setup` is documented as deterministic — so Math.random
 * is not an option here.
 */
function makeRng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

/**
 * Sixteen orders across the last six months, numbered 10225–10240, so the first
 * order placed in a demo is #10241 — the number the parent project's audit-log
 * example uses.
 *
 * Seeding deliberately does NOT decrement stock: historical orders are not
 * current demand, and a demo that starts with a half-empty warehouse is worse
 * than one that starts full.
 */
export async function seedOrders(db: LibSQLDatabase<typeof schema>): Promise<void> {
  const rng = makeRng(20_260_920);

  const products = await db.select().from(schema.products).orderBy(asc(schema.products.id));
  if (products.length === 0) throw new Error('seedOrders: seed the catalog first');

  const addresses = await db.select().from(schema.addresses);
  const cards = await db.select().from(schema.paymentMethods);

  const defaultAddressFor = (customerId: number) =>
    addresses.find((a) => a.customerId === customerId && a.isDefault)
      ?? addresses.find((a) => a.customerId === customerId)!;
  const defaultCardFor = (customerId: number) =>
    cards.find((c) => c.customerId === customerId && c.isDefault)
      ?? cards.find((c) => c.customerId === customerId)!;

  const dayMs = 1000 * 60 * 60 * 24;

  for (let index = 0; index < SEEDED_ORDER_COUNT; index += 1) {
    const customerId = ORDER_OWNERS[index];
    const orderNumber = FIRST_SEEDED_ORDER_NUMBER + index;

    // Oldest first: 175 days ago down to 10 days ago, evenly spread.
    const daysAgo = 175 - index * 11;
    const placedAt = new Date(Date.now() - daysAgo * dayMs);

    // Anything older than a month has arrived; the recent ones are in transit.
    const status = daysAgo > 30 ? 'delivered' as const : 'shipped' as const;

    const lineCount = 1 + Math.floor(rng() * 3); // 1–3 distinct products
    const chosen = new Map<number, number>();
    while (chosen.size < lineCount) {
      const product = products[Math.floor(rng() * products.length)];
      if (!chosen.has(product.id)) chosen.set(product.id, 1 + Math.floor(rng() * 2));
    }

    const lines = [...chosen.entries()].map(([productId, quantity]) => {
      const product = products.find((p) => p.id === productId)!;
      return {
        productId,
        nameSnapshot: product.name,
        unitPriceCents: product.priceCents,
        quantity,
        lineTotalCents: product.priceCents * quantity,
      };
    });

    const subtotalCents = lines.reduce((sum, line) => sum + line.lineTotalCents, 0);
    const totals = calcTotals(subtotalCents);

    const [order] = await db.insert(schema.orders).values({
      orderNumber,
      customerId,
      status,
      placedAt,
      subtotalCents: totals.subtotalCents,
      taxCents: totals.taxCents,
      shippingCents: totals.shippingCents,
      totalCents: totals.totalCents,
      shippingAddressId: defaultAddressFor(customerId).id,
      paymentMethodId: defaultCardFor(customerId).id,
    }).returning();

    await db.insert(schema.orderItems).values(
      lines.map((line) => ({ ...line, orderId: order.id })),
    );
  }
}

/** Used by the seed test and by nothing in the application. */
export async function countOrdersFor(
  db: LibSQLDatabase<typeof schema>,
  customerId: number,
): Promise<number> {
  const rows = await db.select().from(schema.orders)
    .where(eq(schema.orders.customerId, customerId));
  return rows.length;
}
