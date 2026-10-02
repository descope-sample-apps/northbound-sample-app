import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/db/client';
import { tokens } from '@/db/schema';
import type { ActorContext } from '@/lib/oauth/types';
import { refuseAgents } from './agentForbidden';
import { record } from './audit';

/**
 * Revokes every live token an agent holds for this customer.
 *
 * Lives in the service layer because that is what it is from the customer's
 * side: an account operation, like removing a saved address. The storefront
 * calls services; it does not reach into the authorization server.
 *
 * Scoped by the context's customer, and it does NOT touch their session. They
 * stay signed in to their own account while the agent stops working — which is
 * the thing two separate identities buy and impersonation cannot.
 *
 * Closed to agents: an agent must not be able to revoke another agent, or
 * itself to cover its tracks.
 */
export async function revokeAgentAccess(
  ctx: ActorContext,
  agentId: string,
  displayName: string,
): Promise<number> {
  await refuseAgents(ctx, 'Revoking an agent');

  const revoked = await db.update(tokens)
    .set({ revokedAt: new Date() })
    .where(and(
      eq(tokens.customerId, ctx.customerId),
      eq(tokens.agentId, agentId),
      isNull(tokens.revokedAt),
    ))
    .returning({ id: tokens.id });

  // Recorded as the CUSTOMER's action, naming the agent it concerned. Faking an
  // actor here would log a revocation as something the agent did to itself.
  await record(ctx, {
    action: 'access_revoked',
    summary: 'Access revoked.',
    agentDisplayName: displayName,
  });

  return revoked.length;
}
