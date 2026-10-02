import { resolveIssuer } from '@/lib/oauth/issuer';
import { getBackchannelRequest, pollBackchannelRequest } from '@/lib/oauth/local/ciba';
import { issueTokensForBackchannel } from '@/lib/oauth/local/issue';
import { verifyAgentSignature } from '@/lib/webbotauth/verify';

/**
 * The agent polls here with its `auth_req_id` until the customer decides.
 *
 * AUTHENTICATION: like /api/agent/authorize this is not bearer-protected — it
 * is how a token is obtained. It is bound instead to the agent that started the
 * request: if that request carried a Web Bot Auth signature, the poll must
 * carry one from the SAME key.
 *
 * Without that binding, `auth_req_id` would be a bearer secret on its own, and
 * anyone who observed it — in a log, in a proxy, over a shoulder — could
 * collect a token the customer approved for somebody else.
 *
 * Every failure is reported as a flat OAuth error. In particular a mismatched
 * key gets `invalid_grant`, the same code an unknown id gets, so probing does
 * not reveal whether an id exists.
 */
export async function POST(request: Request): Promise<Response> {
  const issuer = resolveIssuer(request);

  let body: { auth_req_id?: string };
  try {
    body = await request.clone().json();
  } catch {
    return oauthError('invalid_request', 'body must be JSON');
  }

  const authReqId = body.auth_req_id?.trim();
  if (!authReqId) return oauthError('invalid_request', 'auth_req_id is required');

  const pending = await getBackchannelRequest(authReqId);
  if (!pending) return oauthError('invalid_grant', 'unknown auth_req_id');

  // Bind the poll to the key that started the flow.
  if (pending.agentKeyId) {
    const verification = await verifyAgentSignature(request);
    if (!verification.verified || verification.keyId !== pending.agentKeyId) {
      return oauthError('invalid_grant', 'unknown auth_req_id');
    }
  }

  const result = await pollBackchannelRequest(authReqId);

  switch (result.status) {
    case 'authorization_pending':
      return oauthError('authorization_pending', 'the customer has not decided yet');
    case 'slow_down':
      return oauthError('slow_down', 'poll no faster than the interval you were given');
    case 'access_denied':
      return oauthError('access_denied', 'the customer declined');
    case 'expired_token':
      return oauthError('expired_token', 'the request expired before it was approved');
    case 'invalid_grant':
      return oauthError('invalid_grant', 'unknown auth_req_id');
    case 'approved': {
      const issued = await issueTokensForBackchannel(result.request, issuer);
      // Null means another poll consumed it first. Reported as invalid_grant so
      // a replayed exchange is indistinguishable from an unknown id.
      if (!issued) return oauthError('invalid_grant', 'already exchanged');
      return Response.json(issued, { headers: { 'cache-control': 'no-store' } });
    }
  }
}

function oauthError(error: string, description: string): Response {
  return Response.json(
    { error, error_description: description },
    { status: 400, headers: { 'cache-control': 'no-store' } },
  );
}
