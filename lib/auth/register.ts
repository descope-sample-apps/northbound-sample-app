import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { customers } from '@/db/schema';
import { ValidationError } from '@/lib/services/errors';
import { hashPassword } from './password';

const RegisterSchema = z.object({
  email: z.email('Enter a valid email address'),
  name: z.string().trim().min(1, 'Name is required').max(120),
  password: z.string().min(10, 'Use at least 10 characters'),
});

export type RegisterInput = z.input<typeof RegisterSchema>;

/**
 * Creates an ordinary local customer.
 *
 * New accounts are always `authBackend: 'local'` and `signupOrigin: 'web'` —
 * the legacy backend is a system we do not own and cannot write to, and Google
 * origin is historical provenance rather than something this form can produce.
 *
 * The id is allocated by SQLite rather than chosen here, so a new signup can
 * never collide with the seeded 82731 / 19382 / 44102.
 */
export async function registerCustomer(raw: RegisterInput): Promise<number> {
  const parsed = RegisterSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0].message);

  const email = parsed.data.email.trim().toLowerCase();

  const [existing] = await db.select().from(customers)
    .where(eq(customers.email, email)).limit(1);
  if (existing) throw new ValidationError('That email is already registered.');

  const now = new Date();
  const [created] = await db.insert(customers).values({
    email,
    name: parsed.data.name,
    emailVerified: false,
    passwordHash: await hashPassword(parsed.data.password),
    authBackend: 'local',
    signupOrigin: 'web',
    passwordSetAt: now,
    createdAt: now,
  }).returning();

  return created.id;
}
