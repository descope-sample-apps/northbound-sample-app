import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';
import { customers } from './customers';

export const addresses = sqliteTable('addresses', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  customerId: integer('customer_id').notNull().references(() => customers.id),
  label: text('label').notNull(),
  recipient: text('recipient').notNull(),
  line1: text('line1').notNull(),
  line2: text('line2'),
  city: text('city').notNull(),
  region: text('region').notNull(),
  postalCode: text('postal_code').notNull(),
  country: text('country').notNull().default('US'),
  phone: text('phone'),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

// ============================================================================
// SECURITY BOUNDARY — no column here can hold a real card number
// ============================================================================
// Brand, last four digits, expiry and holder name. That is the whole record.
// There is no field a full number, CVV, or token could be written to, so a
// mistake upstream has nowhere to land. This is enforced by the schema rather
// than by a comment on the form, because the form is easier to change.
//
// Sub-project D denies agents this operation outright — an agent may never add
// or remove a payment method, at any amount, under any authorization.
// ============================================================================
export const paymentMethods = sqliteTable('payment_methods', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  customerId: integer('customer_id').notNull().references(() => customers.id),
  brand: text('brand', { enum: ['visa', 'mastercard', 'amex'] }).notNull(),
  last4: text('last4').notNull(),
  expMonth: integer('exp_month').notNull(),
  expYear: integer('exp_year').notNull(),
  holderName: text('holder_name').notNull(),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export type Address = typeof addresses.$inferSelect;
export type PaymentMethod = typeof paymentMethods.$inferSelect;
