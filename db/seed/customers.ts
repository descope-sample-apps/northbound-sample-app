import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from '@/db/schema';
import { legacyCredentials } from '@/db/schema/legacy';
import { hashPassword } from '@/lib/auth/password';

/**
 * Demo passwords, documented in the README.
 *
 *   alice@example.com  ->  alpine-trail-2019      (local scrypt hash)
 *   bob@example.com    ->  northbound-legacy-99   (LEGACY BACKEND ONLY)
 *   carol@example.com  ->  summit-ridge-4410      (local scrypt hash)
 *
 * Bob's password is written ONLY to legacy_credentials. His
 * customers.password_hash stays NULL, which is what makes the delegation real
 * rather than decorative — there is no local credential to fall back to.
 *
 * These are plaintext in source because this is a reference implementation with
 * no real users and a README that has to tell you how to log in. Do not carry
 * this pattern anywhere near production.
 */
export const DEMO_PASSWORDS = {
  alice: 'alpine-trail-2019',
  bob: 'northbound-legacy-99',
  carol: 'summit-ridge-4410',
} as const;

export const ALICE_ID = 82_731;
export const BOB_ID = 19_382;
export const CAROL_ID = 44_102;

const BOB_LEGACY_USER_ID = 5_501;

export async function seedCustomers(db: LibSQLDatabase<typeof schema>): Promise<void> {
  await db.insert(schema.customers).values([
    {
      id: ALICE_ID,
      email: 'alice@example.com',
      name: 'Alice Chen',
      emailVerified: true,
      passwordHash: await hashPassword(DEMO_PASSWORDS.alice),
      authBackend: 'local',
      signupOrigin: 'web',
      passwordSetAt: new Date('2021-03-14T10:22:00Z'),
      createdAt: new Date('2021-03-14T10:22:00Z'),
    },
    {
      // The 2019 account. No local hash at all.
      id: BOB_ID,
      email: 'bob@example.com',
      name: 'Bob Ferreira',
      emailVerified: false,
      passwordHash: null,
      authBackend: 'legacy',
      signupOrigin: 'web',
      passwordSetAt: null,
      createdAt: new Date('2019-06-02T18:41:00Z'),
    },
    {
      // Signed up with Google in 2023 and set a password in 2024. The ordering
      // matters: "signed up with Google" and "has a password" only cohere if
      // the password came later.
      id: CAROL_ID,
      email: 'carol@example.com',
      name: 'Carol Nwosu',
      emailVerified: true,
      passwordHash: await hashPassword(DEMO_PASSWORDS.carol),
      authBackend: 'local',
      signupOrigin: 'google',
      passwordSetAt: new Date('2024-05-09T09:15:00Z'),
      createdAt: new Date('2023-08-21T14:03:00Z'),
    },
  ]);

  await db.insert(legacyCredentials).values({
    legacyUserId: BOB_LEGACY_USER_ID,
    email: 'bob@example.com',
    passwordHash: await hashPassword(DEMO_PASSWORDS.bob),
    createdAt: new Date('2019-06-02T18:41:00Z'),
  });
}
