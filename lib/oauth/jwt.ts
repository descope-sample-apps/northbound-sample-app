import { randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { getSigningKey } from './keys';
import { resourceIdentifier } from './issuer';
import type { AccessTokenClaims, AuthorizationDetail } from './types';

export const ACCESS_TOKEN_TTL_SECONDS = 900; // 15 minutes, per the parent spec

export type AccessTokenInput = {
  customerId: number;
  /** null when the customer obtained the token directly, with no agent involved. */
  agentId: string | null;
  clientId: string;
  scope: string;
  authorizationDetails?: AuthorizationDetail[];
};

export type SignedAccessToken = {
  token: string;
  jti: string;
  expiresAt: Date;
};

/**
 * Mints an access token naming BOTH identities.
 *
 * `sub` is always the customer. `act.sub` is the agent, and is omitted entirely
 * when there is none. That asymmetry is the whole point: a resource server can
 * always answer "who is this for?" and "who is asking?" separately, and an
 * agent can never impersonate the customer it acts for.
 */
export async function signAccessToken(
  input: AccessTokenInput,
  issuer: string,
): Promise<SignedAccessToken> {
  const { privateKey, kid } = await getSigningKey();

  const jti = randomUUID();
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAtSeconds = issuedAt + ACCESS_TOKEN_TTL_SECONDS;

  const payload: Record<string, unknown> = {
    client_id: input.clientId,
    scope: input.scope,
  };

  if (input.agentId) payload.act = { sub: input.agentId };
  if (input.authorizationDetails?.length) {
    payload.authorization_details = input.authorizationDetails;
  }

  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'RS256', kid, typ: 'at+jwt' })
    .setIssuer(issuer)
    .setAudience(resourceIdentifier(issuer))
    .setSubject(`user_${input.customerId}`)
    .setJti(jti)
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAtSeconds)
    .sign(privateKey);

  return { token, jti, expiresAt: new Date(expiresAtSeconds * 1000) };
}

/**
 * Verifies signature, issuer, audience and expiry.
 *
 * This is NOT the whole check. A signature proves a token was minted here; it
 * says nothing about whether it has since been revoked. The bearer guard
 * consults the token record as well — see app/api/_lib/withBearer.ts.
 *
 * `algorithms` is pinned to RS256 so a token claiming `alg: none`, or a
 * symmetric algorithm using the public key as its secret, is rejected outright.
 */
export async function verifyAccessTokenSignature(
  token: string,
  issuer: string,
  audience: string,
): Promise<AccessTokenClaims> {
  const { publicKey } = await getSigningKey();

  const { payload } = await jwtVerify(token, publicKey, {
    issuer,
    audience,
    algorithms: ['RS256'],
  });

  return payload as unknown as AccessTokenClaims;
}

/** Customer id back out of a `sub`, or null when it is not one of ours. */
export function customerIdFromSubject(subject: string): number | null {
  const match = /^user_(\d+)$/.exec(subject);
  return match ? Number(match[1]) : null;
}
