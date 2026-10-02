import { resolveIssuer, resourceIdentifier } from '@/lib/oauth/issuer';
import { findLiveAccessToken } from '@/lib/oauth/local/tokens';
import { verifyAccessTokenSignature, customerIdFromSubject } from '@/lib/oauth/jwt';
import {
  isScope, type ActorContext, type AuthorizationDetail, type Scope,
} from '@/lib/oauth/types';
import {
  ConcurrencyError, NotFoundError, OutOfStockError, OwnershipError,
  PriceChangedError, ServiceError, ValidationError,
} from '@/lib/services/errors';

// ============================================================================
// THE ONLY WAY INTO /api/*
// ============================================================================
// This file never reads a cookie, and nothing under app/api/ imports the
// session helpers — a test asserts that structurally rather than trusting it.
//
// That is the point of the whole exercise. A browser session identifies a
// PERSON; an access token identifies an agent acting FOR a person. If the API
// accepted the session cookie, the two would be indistinguishable the moment
// an agent got hold of one, and every guarantee below would be decorative.
//
// Northbound's session cookie could not be used here even by accident: it is
// 32 opaque random bytes with no claims and no signature, so there is nothing
// for verifyAccessTokenSignature to accept.
// ============================================================================

type Handler = (ctx: ActorContext, request: Request) => Promise<Response>;

export function withBearer(requiredScopes: Scope[], handler: Handler) {
  return async function route(request: Request): Promise<Response> {
    const issuer = resolveIssuer(request);
    const challenge = (error: string, description: string, scope?: string) =>
      unauthorized(issuer, error, description, scope);

    const presented = bearerToken(request.headers.get('authorization'));
    if (!presented) {
      return challenge('invalid_request', 'a bearer token is required');
    }

    let claims;
    try {
      claims = await verifyAccessTokenSignature(
        presented, issuer, resourceIdentifier(issuer),
      );
    } catch {
      // One message for every signature, issuer, audience and expiry failure.
      // Telling a caller which one it was helps nobody but an attacker.
      return challenge('invalid_token', 'the token is not valid for this resource');
    }

    // A signature stays valid after revocation, so the record has to be
    // consulted. Without this, revoking a token would do nothing until it
    // expired on its own — fifteen minutes an agent should not have.
    const record = await findLiveAccessToken(claims.jti);
    if (!record) {
      return challenge('invalid_token', 'the token is not valid for this resource');
    }

    const granted = claims.scope.split(/\s+/).filter(isScope);
    const missing = requiredScopes.filter((scope) => !granted.includes(scope));
    if (missing.length > 0) {
      return forbidden(issuer, missing.join(' '));
    }

    const customerId = customerIdFromSubject(claims.sub);
    if (customerId === null) {
      return challenge('invalid_token', 'the token is not valid for this resource');
    }

    const ctx: ActorContext = {
      customerId,
      actor: claims.act
        ? { agentId: claims.act.sub, clientId: claims.client_id }
        : null,
      scopes: granted,
      authorizationDetails: (claims.authorization_details ?? []) as AuthorizationDetail[],
      source: 'api',
    };

    try {
      return await handler(ctx, request);
    } catch (error) {
      return serviceErrorResponse(error);
    }
  };
}

function bearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/.exec(header.trim());
  return match ? match[1] : null;
}

/**
 * Every 401 carries the pointer that lets an agent find its way in.
 *
 * This is the one place it is built, so the challenge cannot drift between
 * routes — and it is the only thing standing between an agent that has never
 * heard of Northbound and a token it can use.
 */
function unauthorized(
  issuer: string,
  error: string,
  description: string,
  scope?: string,
): Response {
  const parts = [
    'realm="Northbound"',
    `error="${error}"`,
    `error_description="${description}"`,
    `resource_metadata="${issuer}/.well-known/oauth-protected-resource"`,
  ];
  if (scope) parts.push(`scope="${scope}"`);

  return Response.json(
    { error, error_description: description },
    {
      status: 401,
      headers: {
        'www-authenticate': `Bearer ${parts.join(', ')}`,
        'cache-control': 'no-store',
      },
    },
  );
}

function forbidden(issuer: string, scope: string): Response {
  return Response.json(
    { error: 'insufficient_scope', error_description: `requires scope: ${scope}` },
    {
      status: 403,
      headers: {
        'www-authenticate':
          `Bearer realm="Northbound", error="insufficient_scope", `
          + `scope="${scope}", `
          + `resource_metadata="${issuer}/.well-known/oauth-protected-resource"`,
        'cache-control': 'no-store',
      },
    },
  );
}

/**
 * Service errors map to status codes in exactly one place.
 *
 * The services throw domain errors and know nothing about HTTP, which is what
 * lets the storefront and this API share them. This is where that choice gets
 * paid off.
 */
export function serviceErrorResponse(error: unknown): Response {
  if (!(error instanceof ServiceError)) throw error;

  const status =
    error instanceof NotFoundError ? 404
    : error instanceof OwnershipError ? 403
    : error instanceof PriceChangedError ? 409
    : error instanceof ConcurrencyError ? 503
    : error instanceof OutOfStockError || error instanceof ValidationError ? 400
    : 400;

  const headers: Record<string, string> = { 'cache-control': 'no-store' };
  if (error instanceof ConcurrencyError) headers['retry-after'] = '1';

  return Response.json({ error: error.code, error_description: error.message }, {
    status, headers,
  });
}
