import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { agents, backchannelRequests, tokens, type BackchannelRequest } from '@/db/schema';
import { signAccessToken, ACCESS_TOKEN_TTL_SECONDS } from '@/lib/oauth/jwt';
import type { AuthorizationDetail } from '@/lib/oauth/types';

const REFRESH_TTL_MS = 1000 * 60 * 60 * 24 * 30;

export type IssuedTokens = {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
  authorization_details?: AuthorizationDetail[];
};

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

/**
 * Makes sure a durable agent row exists for whoever was granted this.
 *
 * The backchannel row denormalises the agent's identity so the consent record
 * stays true to the moment it was approved. But the per-agent activity view and
 * the revoke button both need something stable to point at, and a verified
 * stranger would otherwise leave no trace to revoke.
 *
 * Identified by the signing key where there is one, so the same agent coming
 * back is recognised rather than accumulating a row per request.
 */
async function ensureAgentRow(request: BackchannelRequest): Promise<string> {
  const agentId = request.agentKeyId
    ? `agent_key_${hash(request.agentKeyId).slice(0, 24)}`
    : `agent_unverified_${hash(request.agentDisplayName).slice(0, 16)}`;

  const [existing] = await db.select().from(agents)
    .where(eq(agents.id, agentId)).limit(1);
  if (existing) return agentId;

  await db.insert(agents).values({
    id: agentId,
    displayName: request.agentDisplayName,
    owner: request.agentDirectoryUrl
      ? new URL(request.agentDirectoryUrl).host
      : 'Self-declared',
    description: request.agentVerified
      ? 'Identified by a Web Bot Auth signature.'
      : 'Self-declared on the agent sign-in page; identity not proven.',
    createdAt: new Date(),
  });

  return agentId;
}

/**
 * Turns an approved backchannel request into tokens, exactly once.
 *
 * The request is marked consumed in the same step. A second poll finds nothing
 * approved and gets `invalid_grant`, so observing a successful exchange does
 * not let it be replayed.
 */
export async function issueTokensForBackchannel(
  request: BackchannelRequest,
  issuer: string,
): Promise<IssuedTokens | null> {
  if (request.status !== 'approved' || request.customerId === null) return null;

  // Consume first. If this update matches nothing, another poll got there
  // first and this one must not also mint a token.
  const consumed = await db.update(backchannelRequests)
    .set({ status: 'consumed' })
    .where(and(
      eq(backchannelRequests.id, request.id),
      eq(backchannelRequests.status, 'approved'),
    ))
    .returning({ id: backchannelRequests.id });

  if (consumed.length === 0) return null;

  const agentId = await ensureAgentRow(request);

  const details = request.authorizationDetails
    ? (JSON.parse(request.authorizationDetails) as AuthorizationDetail[])
    : [];

  // The JWT's client_id claim names the agent when no OAuth client exists —
  // a consumer of the token needs *something* to attribute it to. The database
  // column is stricter: it stays null unless there is a real client row.
  const { token: accessToken, jti, expiresAt } = await signAccessToken(
    {
      customerId: request.customerId,
      agentId,
      clientId: request.clientId ?? agentId,
      scope: request.scope,
      authorizationDetails: details,
    },
    issuer,
  );

  const refreshToken = randomBytes(32).toString('base64url');
  const now = new Date();

  await db.insert(tokens).values([
    {
      id: randomUUID(),
      kind: 'access',
      tokenHash: hash(accessToken),
      jti,
      clientId: request.clientId,
      agentId,
      customerId: request.customerId,
      scope: request.scope,
      authorizationDetails: request.authorizationDetails,
      createdAt: now,
      expiresAt,
    },
    {
      id: randomUUID(),
      kind: 'refresh',
      tokenHash: hash(refreshToken),
      jti: randomUUID(),
      clientId: request.clientId,
      agentId,
      customerId: request.customerId,
      scope: request.scope,
      authorizationDetails: request.authorizationDetails,
      createdAt: now,
      expiresAt: new Date(now.getTime() + REFRESH_TTL_MS),
    },
  ]);

  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refreshToken,
    scope: request.scope,
    authorization_details: details.length > 0 ? details : undefined,
  };
}
