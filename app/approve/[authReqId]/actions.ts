'use server';

import { revalidatePath } from 'next/cache';
import { requireCustomer } from '@/lib/auth/session-cookie';
import { decideBackchannelRequest } from '@/lib/oauth/local/ciba';

export type DecisionState = { decided?: 'approved' | 'denied'; error?: string };

/**
 * Records the customer's decision.
 *
 * decideBackchannelRequest scopes by the signed-in customer, so guessing an
 * auth_req_id does not let somebody approve a grant on another account.
 */
export async function decideAction(
  _previous: DecisionState,
  formData: FormData,
): Promise<DecisionState> {
  const customer = await requireCustomer();
  const authReqId = String(formData.get('authReqId') ?? '');
  const decision = String(formData.get('decision') ?? '');

  if (decision !== 'approved' && decision !== 'denied') {
    return { error: 'Unrecognised decision.' };
  }

  const ok = await decideBackchannelRequest(authReqId, customer.id, decision);
  if (!ok) {
    return { error: 'That request has already been answered, or it expired.' };
  }

  revalidatePath(`/approve/${authReqId}`);
  return { decided: decision };
}
