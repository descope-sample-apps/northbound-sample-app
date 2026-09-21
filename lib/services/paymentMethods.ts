import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { paymentMethods, type PaymentMethod } from '@/db/schema';
import { NotFoundError, ValidationError } from './errors';

// ============================================================================
// SECURITY BOUNDARY
// ============================================================================
// This schema accepts the LAST FOUR DIGITS and nothing else. There is no field
// here, and no column in the table, that a full card number could be written
// to — so a mistake in a form or an API client has nowhere to land.
//
// Sub-project D denies agents this operation outright: an agent may never add
// or remove a payment method, at any amount, under any authorization. That is
// why there is no MCP tool for it either.
// ============================================================================
const PaymentMethodSchema = z.object({
  brand: z.enum(['visa', 'mastercard', 'amex']),
  last4: z.string().regex(/^\d{4}$/, 'Enter the last four digits only'),
  expMonth: z.number().int().min(1).max(12),
  expYear: z.number().int().min(2024).max(2099),
  holderName: z.string().trim().min(1, 'Cardholder name is required').max(120),
  isDefault: z.boolean().default(false),
});

export type PaymentMethodInput = z.input<typeof PaymentMethodSchema>;

export async function listPaymentMethods(customerId: number): Promise<PaymentMethod[]> {
  return db
    .select()
    .from(paymentMethods)
    .where(eq(paymentMethods.customerId, customerId))
    .orderBy(desc(paymentMethods.isDefault), desc(paymentMethods.createdAt));
}

async function clearDefaults(customerId: number): Promise<void> {
  await db.update(paymentMethods)
    .set({ isDefault: false })
    .where(eq(paymentMethods.customerId, customerId));
}

/**
 * There is no update function on purpose: a card is added or removed. Editing
 * the digits of a stored card is not a thing a real payment vault permits.
 */
export async function addPaymentMethod(
  customerId: number,
  raw: PaymentMethodInput,
): Promise<PaymentMethod> {
  const parsed = PaymentMethodSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0].message);

  if (parsed.data.isDefault) await clearDefaults(customerId);

  const [created] = await db.insert(paymentMethods)
    .values({ ...parsed.data, customerId, createdAt: new Date() })
    .returning();

  return created;
}

export async function deletePaymentMethod(customerId: number, id: number): Promise<void> {
  const deleted = await db.delete(paymentMethods)
    .where(and(eq(paymentMethods.id, id), eq(paymentMethods.customerId, customerId)))
    .returning();

  if (deleted.length === 0) throw new NotFoundError('Payment method');
}

export async function setDefaultPaymentMethod(
  customerId: number,
  id: number,
): Promise<void> {
  const [exists] = await db.select().from(paymentMethods)
    .where(and(eq(paymentMethods.id, id), eq(paymentMethods.customerId, customerId)))
    .limit(1);
  if (!exists) throw new NotFoundError('Payment method');

  await clearDefaults(customerId);
  await db.update(paymentMethods)
    .set({ isDefault: true })
    .where(and(eq(paymentMethods.id, id), eq(paymentMethods.customerId, customerId)));
}
