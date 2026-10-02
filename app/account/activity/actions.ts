'use server';

import { revalidatePath } from 'next/cache';
import { requireCustomer } from '@/lib/auth/session-cookie';
import { browserContext } from '@/lib/oauth/types';
import { revokeAgentAccess } from '@/lib/services/agentAccess';

export type RevokeState = { revoked?: number; error?: string };

/**
 * Revokes every live token an agent holds for this customer.
 *
 * Scoped by customerId, so revoking reaches only this customer's grants — and
 * crucially it does NOT touch their session. The customer stays signed in to
 * their own account while the agent stops working, which is the whole point of
 * the two identities being separate.
 */
export async function revokeAgentAction(
  _previous: RevokeState,
  formData: FormData,
): Promise<RevokeState> {
  const customer = await requireCustomer();
  const agentId = String(formData.get('agentId') ?? '');
  const displayName = String(formData.get('displayName') ?? agentId);

  if (!agentId) return { error: 'Which agent?' };

  const revoked = await revokeAgentAccess(
    browserContext(customer.id), agentId, displayName,
  );

  revalidatePath('/account/activity');
  return { revoked };
}
