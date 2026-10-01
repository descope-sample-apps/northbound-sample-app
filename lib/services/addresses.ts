import type { ActorContext } from '@/lib/oauth/types';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { addresses, orders, type Address } from '@/db/schema';
import { NotFoundError, ValidationError } from './errors';

const AddressSchema = z.object({
  id: z.number().int().positive().optional(),
  label: z.string().trim().min(1, 'Label is required').max(40),
  recipient: z.string().trim().min(1, 'Recipient is required').max(120),
  line1: z.string().trim().min(1, 'Street address is required').max(200),
  line2: z.string().trim().max(200).nullish(),
  city: z.string().trim().min(1, 'City is required').max(100),
  region: z.string().trim().min(1, 'State or region is required').max(100),
  postalCode: z.string().trim().min(1, 'Postal code is required').max(20),
  country: z.string().trim().length(2).default('US'),
  phone: z.string().trim().max(40).nullish(),
  isDefault: z.boolean().default(false),
});

export type AddressInput = z.input<typeof AddressSchema>;

export async function listAddresses(ctx: ActorContext): Promise<Address[]> {
  const { customerId } = ctx;
  return db
    .select()
    .from(addresses)
    .where(eq(addresses.customerId, customerId))
    .orderBy(desc(addresses.isDefault), desc(addresses.createdAt));
}

async function clearDefaults(customerId: number): Promise<void> {
  await db.update(addresses)
    .set({ isDefault: false })
    .where(eq(addresses.customerId, customerId));
}

export async function upsertAddress(
  ctx: ActorContext,
  raw: AddressInput,
): Promise<Address> {
  const { customerId } = ctx;
  const parsed = AddressSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0].message);

  const { id, ...values } = parsed.data;
  const normalized = {
    ...values,
    line2: values.line2 ?? null,
    phone: values.phone ?? null,
  };

  if (id !== undefined) {
    // Scoped by customerId: editing someone else's address is NOT FOUND, not
    // FORBIDDEN, because "forbidden" would confirm the row exists. Clearing
    // defaults happens only after the row is known to belong to this customer,
    // so a failed attempt cannot strip their existing default.
    const [exists] = await db.select().from(addresses)
      .where(and(eq(addresses.id, id), eq(addresses.customerId, customerId)))
      .limit(1);
    if (!exists) throw new NotFoundError('Address');

    if (normalized.isDefault) await clearDefaults(customerId);

    const [updated] = await db.update(addresses)
      .set(normalized)
      .where(and(eq(addresses.id, id), eq(addresses.customerId, customerId)))
      .returning();

    return updated;
  }

  if (normalized.isDefault) await clearDefaults(customerId);

  const [created] = await db.insert(addresses)
    .values({ ...normalized, customerId, createdAt: new Date() })
    .returning();

  return created;
}

export async function deleteAddress(ctx: ActorContext, id: number): Promise<void> {
  const { customerId } = ctx;
  const [exists] = await db.select().from(addresses)
    .where(and(eq(addresses.id, id), eq(addresses.customerId, customerId)))
    .limit(1);
  if (!exists) throw new NotFoundError('Address');

  // orders.shipping_address_id is a real foreign key, so deleting an address a
  // past order points at raises SQLITE_CONSTRAINT_FOREIGNKEY — a driver error,
  // not a ServiceError, which would reach the customer as a crash. Every seeded
  // order uses its customer's default address, so this is reachable on the
  // first click for anyone with one saved address.
  const [used] = await db.select({ id: orders.id }).from(orders)
    .where(eq(orders.shippingAddressId, id))
    .limit(1);

  if (used) {
    throw new ValidationError(
      'This address is used by past orders and cannot be removed. '
      + 'Add a new one and make it your default instead.',
    );
  }

  await db.delete(addresses)
    .where(and(eq(addresses.id, id), eq(addresses.customerId, customerId)));
}

export async function setDefaultAddress(ctx: ActorContext, id: number): Promise<void> {
  const { customerId } = ctx;
  const [exists] = await db.select().from(addresses)
    .where(and(eq(addresses.id, id), eq(addresses.customerId, customerId)))
    .limit(1);
  if (!exists) throw new NotFoundError('Address');

  await clearDefaults(customerId);
  await db.update(addresses)
    .set({ isDefault: true })
    .where(and(eq(addresses.id, id), eq(addresses.customerId, customerId)));
}
