import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { customers, type Customer } from '@/db/schema';
import { upsertAddress } from '@/lib/services/addresses';
import { addPaymentMethod } from '@/lib/services/paymentMethods';

/**
 * Demo only (DEMO_AUTO_SIGNUP=true): the first time someone approves an agent with an email
 * Northbound hasn't seen, create the customer, so readers can try the flow with their own
 * email and no sign-up step. Descope's sign-in has already verified the email.
 *
 * The account gets a sample address and a test card, so checkout works straight away. It has
 * no password; the customer can still create one through the normal sign-up later.
 */
export async function createDemoCustomer(email: string, name?: string): Promise<Customer> {
  const normalized = email.trim().toLowerCase();
  const displayName = name?.trim() || normalized.split('@')[0];

  let created: Customer | undefined;
  try {
    [created] = await db.insert(customers).values({
      email: normalized,
      name: displayName,
      emailVerified: true,
      passwordHash: null,
      authBackend: 'local',
      signupOrigin: 'web',
      passwordSetAt: null,
      createdAt: new Date(),
    }).returning();
  } catch {
    // Two first requests at once: the other one created it.
    const [existing] = await db.select().from(customers).where(eq(customers.email, normalized)).limit(1);
    if (existing) return existing;
    throw new Error(`could not create a demo customer for ${normalized}`);
  }

  await upsertAddress(created.id, {
    label: 'Home',
    recipient: displayName,
    line1: '1 Trailhead Way',
    city: 'Bend',
    region: 'OR',
    postalCode: '97701',
    country: 'US',
    isDefault: true,
  });
  await addPaymentMethod(created.id, {
    brand: 'visa',
    last4: '4242',
    expMonth: 12,
    expYear: new Date().getFullYear() + 3,
    holderName: displayName,
    isDefault: true,
  });
  return created;
}
