'use server';

import { headers } from 'next/headers';
import { startAgentAuthorization } from '@/lib/agents/startAuthorization';
import { resolveIssuer } from '@/lib/oauth/issuer';

export type ConnectState = {
  error?: string;
  started?: {
    authReqId: string;
    interval: number;
    agentName: string;
    verified: boolean;
    tier: string;
  };
};

/**
 * The browser door onto the same backend function the API uses.
 *
 * A computer-use agent fills in the customer's email and clicks the button for
 * its own platform. That click is a CLAIM, not proof — it names the agent on
 * the consent screen and in the audit log, and earns no spending cap. If the
 * agent also signs the request with Web Bot Auth, the signature wins and the
 * claim is ignored.
 */
export async function connectAgentAction(
  _previous: ConnectState,
  formData: FormData,
): Promise<ConnectState> {
  const email = String(formData.get('email') ?? '').trim();
  const platform = String(formData.get('platform') ?? '').trim() || undefined;

  if (!email.includes('@')) {
    return { error: 'Enter the email address of the account you are connecting.' };
  }

  const headerList = await headers();
  const issuer = resolveIssuer(new Request('http://localhost', { headers: headerList }));

  // A server action carries no signature, so this path always resolves to the
  // declared or unverified tier. An agent that can sign uses the API instead.
  const { identity, start } = await startAgentAuthorization({
    request: new Request('http://localhost/api/agent/authorize', {
      method: 'POST', body: '{}',
    }),
    loginHint: email,
    declaredPlatform: platform,
    issuer,
  });

  return {
    started: {
      authReqId: start.auth_req_id,
      interval: start.interval,
      agentName: identity.displayName,
      verified: identity.verified,
      tier: identity.tier,
    },
  };
}
