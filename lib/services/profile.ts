import type { ActorContext } from '@/lib/oauth/types';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { customers } from '@/db/schema';
import { NotFoundError, ValidationError } from './errors';
import { refuseAgents } from './agentForbidden';

export type Profile = {
  id: number;
  name: string;
  email: string;
  emailVerified: boolean;
  createdAt: Date;
};

export async function getProfile(ctx: ActorContext): Promise<Profile> {
  const { customerId } = ctx;
  const [customer] = await db
    .select()
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);

  if (!customer) throw new NotFoundError('Customer');

  // Deliberately does not return passwordHash, authBackend, or signupOrigin.
  // Which backend holds a customer's credential is not the customer's business
  // and definitely not an API consumer's.
  return {
    id: customer.id,
    name: customer.name,
    email: customer.email,
    emailVerified: customer.emailVerified,
    createdAt: customer.createdAt,
  };
}

const UpdateProfileSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
});

/**
 * Browser-only.
 *
 * The parent project's scope list contains `profile.read` with no write
 * counterpart, and its MCP tool list contains `get_profile` with no
 * `update_profile`. Agents therefore cannot change a customer's name by
 * design. If a write scope is wanted later it must be added to the parent spec
 * deliberately — it should not be invented during implementation.
 *
 * Email is not updatable here at all: changing it would need re-verification,
 * and in sub-project C identity linking must survive an email change rather
 * than depend on it.
 */
export async function updateProfile(
  ctx: ActorContext,
  input: z.input<typeof UpdateProfileSchema>,
): Promise<void> {
  const { customerId } = ctx;
  refuseAgents(ctx, 'Changing account details');
  const parsed = UpdateProfileSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0].message);

  await db.update(customers)
    .set({ name: parsed.data.name })
    .where(eq(customers.id, customerId));
}
