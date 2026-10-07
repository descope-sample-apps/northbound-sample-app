import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import {
  addresses, carts, cartItems, orders, orderItems, paymentMethods, products,
  type Address, type Order, type OrderItem, type PaymentMethod,
} from '@/db/schema';
import { calcTotals } from '@/lib/money';
import { withWriteLock } from './writeLock';
import {
  NotFoundError, OutOfStockError, OwnershipError, PriceChangedError, ValidationError,
} from './errors';

/** Seeded history runs 10225–10240, so the first order placed is 10241. */
export const START_ORDER_NUMBER = 10_241;

const PlaceOrderSchema = z.object({
  addressId: z.number().int().positive(),
  paymentMethodId: z.number().int().positive(),
  /**
   * The total the customer was shown. When present it is enforced, so a price
   * that moved between the cart page and the confirm button fails loudly
   * instead of quietly charging a different number.
   */
  expectedTotalCents: z.number().int().nonnegative().optional(),
  /** The AI agent placing the order for the customer, if one is. */
  placedByAgent: z.string().min(1).optional(),
});

export type PlaceOrderInput = z.input<typeof PlaceOrderSchema>;
export type OrderSummary = Order & { itemCount: number };
export type OrderDetail = Order & {
  items: OrderItem[];
  address: Address;
  paymentMethod: PaymentMethod;
};

export async function placeOrder(
  customerId: number,
  rawInput: PlaceOrderInput,
): Promise<Order> {
  const parsed = PlaceOrderSchema.safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0].message);
  const input = parsed.data;

  // Serialized by withWriteLock: SQLite permits one writer at a time, so two
  // unrelated checkouts contend for the lock even when they share no row, and a
  // contended transaction cannot be retried. See lib/services/writeLock.ts.
  return withWriteLock(() => db.transaction(async (tx) => {
    const [cart] = await tx.select().from(carts)
      .where(eq(carts.customerId, customerId)).limit(1);
    if (!cart) throw new ValidationError('Your cart is empty');

    const lines = await tx
      .select({ item: cartItems, product: products })
      .from(cartItems)
      .innerJoin(products, eq(cartItems.productId, products.id))
      .where(eq(cartItems.cartId, cart.id))
      .orderBy(cartItems.id);

    if (lines.length === 0) throw new ValidationError('Your cart is empty');

    // Ownership: both references are looked up SCOPED BY customerId. Checking
    // ownership by fetching the row and then comparing would be a check someone
    // could later delete; scoping the query makes it structural.
    const [address] = await tx.select().from(addresses)
      .where(and(eq(addresses.id, input.addressId), eq(addresses.customerId, customerId)))
      .limit(1);
    if (!address) throw new OwnershipError('Address');

    const [payment] = await tx.select().from(paymentMethods)
      .where(and(
        eq(paymentMethods.id, input.paymentMethodId),
        eq(paymentMethods.customerId, customerId),
      ))
      .limit(1);
    if (!payment) throw new OwnershipError('Payment method');

    // Re-validate every line against CURRENT catalog state. A product can go
    // inactive or sell out between being added and this checkout, and the
    // customer deserves to be told which one rather than shown a 500.
    for (const { item, product } of lines) {
      if (!product.isActive) {
        throw new ValidationError(`${product.name} is no longer available`);
      }
      if (item.quantity > product.stockQty) {
        throw new OutOfStockError(product.name, product.stockQty);
      }
    }

    const subtotalCents = lines.reduce(
      (sum, { item, product }) => sum + product.priceCents * item.quantity,
      0,
    );
    const totals = calcTotals(subtotalCents);

    if (
      input.expectedTotalCents !== undefined &&
      input.expectedTotalCents !== totals.totalCents
    ) {
      throw new PriceChangedError(input.expectedTotalCents, totals.totalCents);
    }

    for (const { item, product } of lines) {
      // Relative UPDATE with a guard, not read-then-write. The guard is what
      // keeps this correct on an engine without SQLite's single-writer lock —
      // DATABASE_URL is documented as repointable at hosted libsql, where a
      // lost update would oversell silently rather than failing loudly.
      const updated = await tx.update(products)
        .set({ stockQty: sql`${products.stockQty} - ${item.quantity}` })
        .where(and(
          eq(products.id, product.id),
          gte(products.stockQty, item.quantity),
        ))
        .returning({ id: products.id });

      if (updated.length === 0) {
        throw new OutOfStockError(product.name, product.stockQty);
      }
    }

    // orders.order_number is UNIQUE. If two transactions ever computed the same
    // max+1, the second insert fails and its whole transaction rolls back, so
    // two orders can never share a number even under contention.
    const [{ maxNumber }] = await tx
      .select({ maxNumber: sql<number | null>`max(${orders.orderNumber})` })
      .from(orders);

    const orderNumber = maxNumber === null ? START_ORDER_NUMBER : Number(maxNumber) + 1;

    const [order] = await tx.insert(orders).values({
      orderNumber,
      customerId,
      status: 'placed',
      placedAt: new Date(),
      subtotalCents: totals.subtotalCents,
      taxCents: totals.taxCents,
      shippingCents: totals.shippingCents,
      totalCents: totals.totalCents,
      shippingAddressId: address.id,
      paymentMethodId: payment.id,
      placedByAgent: input.placedByAgent ?? null,
    }).returning();

    await tx.insert(orderItems).values(lines.map(({ item, product }) => ({
      orderId: order.id,
      productId: product.id,
      nameSnapshot: product.name,
      unitPriceCents: product.priceCents,
      quantity: item.quantity,
      lineTotalCents: product.priceCents * item.quantity,
    })));

    await tx.delete(cartItems).where(eq(cartItems.cartId, cart.id));

    return order;
  }));
}

export async function listOrders(
  customerId: number,
  options: { limit?: number } = {},
): Promise<OrderSummary[]> {
  // A join plus GROUP BY rather than a correlated subquery: the subquery form
  // silently failed to correlate and summed every order's items into each row.
  const rows = await db
    .select({
      order: orders,
      itemCount: sql<number>`coalesce(sum(${orderItems.quantity}), 0)`,
    })
    .from(orders)
    .leftJoin(orderItems, eq(orderItems.orderId, orders.id))
    .where(eq(orders.customerId, customerId))
    .groupBy(orders.id)
    .orderBy(desc(orders.orderNumber))
    .limit(options.limit ?? 50);

  return rows.map((row) => ({ ...row.order, itemCount: Number(row.itemCount) }));
}

export async function getOrder(
  customerId: number,
  orderNumber: number,
): Promise<OrderDetail> {
  // NaN reaches here whenever a route param was not a number. Reject it before
  // it becomes a confusing database comparison.
  if (!Number.isInteger(orderNumber)) throw new NotFoundError('Order');

  // Scoped by customerId, and NOT FOUND rather than FORBIDDEN on a miss:
  // returning 403 would confirm that someone else's order exists.
  const [order] = await db.select().from(orders)
    .where(and(eq(orders.orderNumber, orderNumber), eq(orders.customerId, customerId)))
    .limit(1);
  if (!order) throw new NotFoundError('Order');

  const items = await db.select().from(orderItems)
    .where(eq(orderItems.orderId, order.id))
    .orderBy(orderItems.id);

  const [address] = await db.select().from(addresses)
    .where(eq(addresses.id, order.shippingAddressId));
  const [paymentMethod] = await db.select().from(paymentMethods)
    .where(eq(paymentMethods.id, order.paymentMethodId));

  return { ...order, items, address, paymentMethod };
}
