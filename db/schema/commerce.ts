import { sqliteTable, integer, text, unique } from 'drizzle-orm/sqlite-core';
import { customers } from './customers';
import { products } from './catalog';
import { addresses, paymentMethods } from './account';

export const carts = sqliteTable('carts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  customerId: integer('customer_id').notNull().references(() => customers.id).unique(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

// No price column on purpose: a cart displays LIVE price. Prices are snapshotted
// once, at order time, into order_items.
export const cartItems = sqliteTable('cart_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  cartId: integer('cart_id').notNull().references(() => carts.id),
  productId: integer('product_id').notNull().references(() => products.id),
  quantity: integer('quantity').notNull(),
}, (t) => [unique('cart_items_cart_product_unique').on(t.cartId, t.productId)]);

export const orders = sqliteTable('orders', {
  id: integer('id').primaryKey({ autoIncrement: true }),

  // Distinct from the primary key so the number shown to customers is stable
  // and readable, and UNIQUE so that if two concurrent transactions ever
  // computed the same max+1 the second insert fails loudly and rolls back
  // rather than producing two orders that share a number.
  orderNumber: integer('order_number').notNull().unique(),

  customerId: integer('customer_id').notNull().references(() => customers.id),
  status: text('status', {
    enum: ['placed', 'shipped', 'delivered', 'cancelled'],
  }).notNull(),
  placedAt: integer('placed_at', { mode: 'timestamp' }).notNull(),
  subtotalCents: integer('subtotal_cents').notNull(),
  taxCents: integer('tax_cents').notNull(),
  shippingCents: integer('shipping_cents').notNull(),
  totalCents: integer('total_cents').notNull(),
  shippingAddressId: integer('shipping_address_id').notNull().references(() => addresses.id),
  paymentMethodId: integer('payment_method_id').notNull().references(() => paymentMethods.id),
  // The AI agent that placed the order for the customer, from its Descope token's act.sub.
  // Null when the customer placed it themselves.
  placedByAgent: text('placed_by_agent'),
});

// nameSnapshot and unitPriceCents exist so order history does not silently
// rewrite itself when the catalog is edited or a product is renamed.
export const orderItems = sqliteTable('order_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  orderId: integer('order_id').notNull().references(() => orders.id),
  productId: integer('product_id').notNull().references(() => products.id),
  nameSnapshot: text('name_snapshot').notNull(),
  unitPriceCents: integer('unit_price_cents').notNull(),
  quantity: integer('quantity').notNull(),
  lineTotalCents: integer('line_total_cents').notNull(),
});

export type Cart = typeof carts.$inferSelect;
export type CartItem = typeof cartItems.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
