import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { backchannelRequests, customers, type BackchannelRequest } from '@/db/schema';
import type { AgentIdentity } from '@/lib/agents/identify';
import { capForTier, scopesForTier, bindingMessageFor } from '@/lib/webbotauth/tiers';
import type { AuthorizationDetail } from '@/lib/oauth/types';

export const CIBA_TTL_SECONDS = 600;
export const CIBA_POLL_INTERVAL_SECONDS = 5;

export type BackchannelStart = {
  auth_req_id: string;
  expires_in: number;
  interval: number;
};

export type BackchannelPoll =
  | { status: 'approved'; request: BackchannelRequest }
  | { status: 'authorization_pending' }
  | { status: 'slow_down' }
  | { status: 'access_denied' }
  | { status: 'expired_token' }
  | { status: 'invalid_grant' };

/**
 * Starts a backchannel authorization.
 *
 * RESPONSE SHAPE IS CONSTANT. The same `auth_req_id`, `expires_in` and
 * `interval` come back whether or not `login_hint` matches a customer, and the
 * approval is only actually delivered when it does.
 *
 * `login_hint` is an unverified assertion by the agent — anyone who can reach
 * this endpoint can name any address. If the response varied, the endpoint
 * would be an account-enumeration oracle: ask it about a thousand addresses
 * and learn which ones shop here. The cost of the constant response is that an
 * agent cannot tell "wrong address" from "user ignored it", which is the right
 * way round.
 */
export async function startBackchannelAuthorization(params: {
  identity: AgentIdentity;
  loginHint: string;
  requestedScope?: string;
  /** Overrides the tier's standing grant; used by step-up. */
  authorizationDetails?: AuthorizationDetail[];
  bindingMessage?: string;
  stepUpForOrderId?: number;
}): Promise<BackchannelStart> {
  const { identity } = params;
  const now = new Date();
  const authReqId = randomBytes(24).toString('base64url');
  const normalizedHint = params.loginHint.trim().toLowerCase();

  // Resolved here, never echoed back. A null customer produces a row that can
  // never be approved, which is indistinguishable from the outside.
  const [customer] = await db.select().from(customers)
    .where(eq(customers.email, normalizedHint)).limit(1);

  const grant = params.authorizationDetails
    ?? (capForTier(identity.tier) ? [capForTier(identity.tier)!] : []);

  const scopes = params.requestedScope
    ? params.requestedScope.split(/\s+/).filter(Boolean)
        .filter((s) => (scopesForTier(identity.tier) as string[]).includes(s))
    : scopesForTier(identity.tier);

  await db.insert(backchannelRequests).values({
    id: authReqId,
    clientId: identity.descopeClientId,
    agentId: null,
    agentDisplayName: identity.displayName,
    agentTier: identity.tier,
    agentVerified: identity.verified,
    agentDirectoryUrl: identity.directoryUrl ?? null,
    loginHint: normalizedHint,
    customerId: customer?.id ?? null,
    scope: scopes.join(' '),
    bindingMessage: params.bindingMessage
      ?? bindingMessageFor(identity.tier, identity.displayName),
    authorizationDetails: grant.length > 0 ? JSON.stringify(grant) : null,
    stepUpForOrderId: params.stepUpForOrderId ?? null,
    status: 'pending',
    pollIntervalSeconds: CIBA_POLL_INTERVAL_SECONDS,
    createdAt: now,
    expiresAt: new Date(now.getTime() + CIBA_TTL_SECONDS * 1000),
  });

  return {
    auth_req_id: authReqId,
    expires_in: CIBA_TTL_SECONDS,
    interval: CIBA_POLL_INTERVAL_SECONDS,
  };
}

/**
 * Polls a pending request.
 *
 * Enforces `interval` by returning `slow_down` to a client that polls faster
 * than it was told to, which is what RFC 8628 and CIBA both expect.
 */
export async function pollBackchannelRequest(authReqId: string): Promise<BackchannelPoll> {
  const [request] = await db.select().from(backchannelRequests)
    .where(eq(backchannelRequests.id, authReqId)).limit(1);

  if (!request) return { status: 'invalid_grant' };

  const now = new Date();

  if (request.status === 'denied') return { status: 'access_denied' };

  if (request.status === 'pending' && request.expiresAt.getTime() <= now.getTime()) {
    await db.update(backchannelRequests)
      .set({ status: 'expired', decidedAt: now })
      .where(eq(backchannelRequests.id, authReqId));
    return { status: 'expired_token' };
  }

  if (request.status === 'expired') return { status: 'expired_token' };

  if (request.status === 'approved') return { status: 'approved', request };

  const tooSoon = request.lastPolledAt
    && now.getTime() - request.lastPolledAt.getTime()
       < request.pollIntervalSeconds * 1000;

  await db.update(backchannelRequests)
    .set({ lastPolledAt: now })
    .where(eq(backchannelRequests.id, authReqId));

  return tooSoon ? { status: 'slow_down' } : { status: 'authorization_pending' };
}

/** What the approval page shows. Only ever returns a still-pending request. */
export async function getPendingRequest(
  authReqId: string,
): Promise<BackchannelRequest | null> {
  const [request] = await db.select().from(backchannelRequests)
    .where(and(
      eq(backchannelRequests.id, authReqId),
      eq(backchannelRequests.status, 'pending'),
    ))
    .limit(1);

  if (!request) return null;
  if (request.expiresAt.getTime() <= Date.now()) return null;
  return request;
}

/**
 * Records the customer's decision.
 *
 * Scoped by customerId: a signed-in customer can only decide a request that
 * resolved to their own account. Someone who guesses an auth_req_id cannot
 * approve a grant for somebody else.
 */
export async function decideBackchannelRequest(
  authReqId: string,
  customerId: number,
  decision: 'approved' | 'denied',
): Promise<boolean> {
  const updated = await db.update(backchannelRequests)
    .set({ status: decision, decidedAt: new Date() })
    .where(and(
      eq(backchannelRequests.id, authReqId),
      eq(backchannelRequests.customerId, customerId),
      eq(backchannelRequests.status, 'pending'),
    ))
    .returning({ id: backchannelRequests.id });

  return updated.length > 0;
}

/**
 * The out-of-band channel, standing in for Descope's approval email.
 *
 * The blog calls this the console-logged "SMS" link. It is logged ONLY when the
 * hint resolved to a real customer, so the log does not leak which addresses
 * have accounts either.
 */
export function deliverApproval(params: {
  authReqId: string;
  customerId: number | null;
  loginHint: string;
  bindingMessage: string;
  issuer: string;
}): void {
  if (params.customerId === null) return;

  const url = `${params.issuer}/approve/${params.authReqId}`;
  console.log(
    `\n[ciba] approval request for ${params.loginHint}\n`
    + `       ${params.bindingMessage}\n`
    + `       ${url}\n`,
  );
}
