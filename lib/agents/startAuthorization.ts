import { identifyAgent, type AgentIdentity } from './identify';
import {
  startBackchannelAuthorization, deliverApproval, type BackchannelStart,
} from '@/lib/oauth/local/ciba';
import { bindingMessageFor } from '@/lib/webbotauth/tiers';

/**
 * The one place a CIBA request is started, for both doors onto it.
 *
 *   POST /api/agent/authorize   an agent calling the API directly
 *   the button on /agents       a computer-use agent driving a browser
 *
 * Northbound is the OAuth client in this flow, not the agent — the agent has
 * no client_id. Which Descope client Northbound uses is chosen by the identity
 * resolved here, and that is what carries the agent into a policy decision.
 *
 * Identification happens on the backend in both cases. Anything the browser
 * asserts is just another claim, so there is nothing to be gained by trusting
 * it earlier.
 */
export async function startAgentAuthorization(params: {
  request: Request;
  loginHint: string;
  declaredPlatform?: string;
  requestedScope?: string;
  issuer: string;
}): Promise<{ identity: AgentIdentity; start: BackchannelStart }> {
  const identity = await identifyAgent(params.request, {
    declaredPlatform: params.declaredPlatform,
  });

  const bindingMessage = bindingMessageFor(identity.tier, identity.displayName);

  const start = await startBackchannelAuthorization({
    identity,
    loginHint: params.loginHint,
    requestedScope: params.requestedScope,
    bindingMessage,
  });

  // Delivery is a no-op when the hint matched nobody, so the out-of-band
  // channel does not leak which addresses have accounts either.
  const { getPendingRequest } = await import('@/lib/oauth/local/ciba');
  const pending = await getPendingRequest(start.auth_req_id);

  deliverApproval({
    authReqId: start.auth_req_id,
    customerId: pending?.customerId ?? null,
    loginHint: params.loginHint,
    bindingMessage,
    bindingCode: start.binding_code,
    issuer: params.issuer,
  });

  return { identity, start };
}
