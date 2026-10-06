import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from '@/db/schema';
import { ALICE_ID, BOB_ID, CAROL_ID } from './customers';

/**
 * Saved addresses and payment methods.
 *
 * Alice has two of each, which is what makes the checkout selector worth
 * looking at. Bob and Carol have one each.
 *
 * Every payment method is brand + last four + expiry. There is nowhere in the
 * schema for a real number, so nothing here needs redacting.
 */
export async function seedAccount(db: LibSQLDatabase<typeof schema>): Promise<void> {
  const now = new Date('2024-01-08T12:00:00Z');

  await db.insert(schema.addresses).values([
    {
      customerId: ALICE_ID, label: 'Home', recipient: 'Alice Chen',
      line1: '1142 SE Ankeny St', line2: 'Apt 3', city: 'Portland',
      region: 'OR', postalCode: '97214', country: 'US',
      phone: '+1 503 555 0147', isDefault: true, createdAt: now,
    },
    {
      customerId: ALICE_ID, label: 'Work', recipient: 'Alice Chen',
      line1: '400 NW 14th Ave', line2: 'Floor 2', city: 'Portland',
      region: 'OR', postalCode: '97209', country: 'US',
      phone: '+1 503 555 0147', isDefault: false, createdAt: now,
    },
    {
      customerId: BOB_ID, label: 'Home', recipient: 'Bob Ferreira',
      line1: '87 Cascade Loop', line2: null, city: 'Bend',
      region: 'OR', postalCode: '97701', country: 'US',
      phone: '+1 541 555 0198', isDefault: true, createdAt: now,
    },
    {
      customerId: CAROL_ID, label: 'Home', recipient: 'Carol Nwosu',
      line1: '2310 N 45th St', line2: null, city: 'Seattle',
      region: 'WA', postalCode: '98103', country: 'US',
      phone: '+1 206 555 0163', isDefault: true, createdAt: now,
    },
  ]);

  await db.insert(schema.paymentMethods).values([
    {
      customerId: ALICE_ID, brand: 'visa', last4: '4242', expMonth: 8,
      expYear: 2029, holderName: 'Alice Chen', isDefault: true, createdAt: now,
    },
    {
      customerId: ALICE_ID, brand: 'amex', last4: '8310', expMonth: 3,
      expYear: 2028, holderName: 'Alice Chen', isDefault: false, createdAt: now,
    },
    {
      customerId: BOB_ID, brand: 'mastercard', last4: '5591', expMonth: 11,
      expYear: 2027, holderName: 'Robert Ferreira', isDefault: true, createdAt: now,
    },
    {
      customerId: CAROL_ID, brand: 'visa', last4: '1881', expMonth: 6,
      expYear: 2030, holderName: 'Carol Nwosu', isDefault: true, createdAt: now,
    },
  ]);
}
