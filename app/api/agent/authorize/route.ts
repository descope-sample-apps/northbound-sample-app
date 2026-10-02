import { resolveIssuer } from '@/lib/oauth/issuer';
import { startAgentAuthorization } from '@/lib/agents/startAuthorization';

/**
 * Starts a backchannel authorization for an agent.
 *
 * AUTHENTICATION: this endpoint is under /api/* but is NOT bearer-protected —
 * it is how an agent OBTAINS a token, so requiring one would be circular. It
 * is authenticated by a Web Bot Auth signature instead, and an unsigned caller
 * is served at the unverified tier rather than refused, because an agent that
 * cannot sign should still be able to ask a customer for read-only access.
 *
 * CONSTANT RESPONSE: the same auth_req_id, expires_in and interval come back
 * whether or not login_hint matches a customer. Varying it would turn this into
 * an account-enumeration oracle — ask about a thousand addresses, learn which
 * ones shop here. The approval is only actually delivered when it matches.
 */
export async function POST(request: Request): Promise<Response> {
  const issuer = resolveIssuer(request);

  // The body is read twice: once here, once by signature verification. Clone
  // first so neither consumes the other's stream.
  let body: { login_hint?: string; scope?: string; platform?: string };
  try {
    body = await request.clone().json();
  } catch {
    return Response.json(
      { error: 'invalid_request', error_description: 'body must be JSON' },
      { status: 400 },
    );
  }

  const loginHint = body.login_hint?.trim();
  if (!loginHint || !loginHint.includes('@')) {
    return Response.json(
      { error: 'invalid_request', error_description: 'login_hint must be an email address' },
      { status: 400 },
    );
  }

  const { identity, start } = await startAgentAuthorization({
    request,
    loginHint,
    declaredPlatform: body.platform,
    requestedScope: body.scope,
    issuer,
  });

  return Response.json(
    {
      ...start,
      // Echoed so an agent can see how it was classified and tell its user why
      // it cannot buy anything. This is Northbound's own extension.
      agent: {
        name: identity.displayName,
        verified: identity.verified,
        tier: identity.tier,
      },
    },
    { status: 200, headers: { 'cache-control': 'no-store' } },
  );
}
