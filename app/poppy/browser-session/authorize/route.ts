import { inspectAgentToken } from '@/lib/agentSession/descope';
import { SCOPE_BROWSER_SIGN_IN, authorizeJoin } from '@/lib/agentSession/browserJoin';
import { refusedBecause } from '@/lib/api/refusal';

/**
 * The Poppy browser-session endpoint, step 2: the assistant authorizes a code.
 *
 * This is the only one of the three requests that carries the access token, and the
 * only one the browser never makes. Section 6: "The access token never passes through
 * the browser."
 *
 * WHAT THIS STORE DOES AND DOES NOT CHECK. Section 6 has the Company check the Session
 * header "as at any resource (5.3)" — verify its signature against the assistant's own
 * key set, check the audience, read the Session out of it. Northbound does not do that
 * anywhere: Agent Edge sits in front of the store and is where Poppy's agent
 * verification lives, which is the same division that leaves this app with one file of
 * agent code (lib/agentSession/descope.ts). So the header is required and its Session
 * recorded, not verified, here.
 *
 * That division is safe for THIS endpoint, and it is worth being exact about why rather
 * than leaving it to be assumed. Nothing in the join's security rests on the Session
 * header. What stops someone else's browser being joined is the code-and-cookie pair
 * (10.6), and what decides whose account the browser acts as is the access token below,
 * which is verified in full. An unverified Session header means the Session a join is
 * recorded against is only as trustworthy as whoever sent it — it does not let anyone
 * reach an account.
 */

export const dynamic = 'force-dynamic';

function invalidRequest(): Response {
  return Response.json({ error: 'invalid_request' }, {
    status: 400,
    headers: { 'cache-control': 'no-store' },
  });
}

export async function POST(request: Request): Promise<Response> {
  const body = await request.json().catch(() => null);
  const code = body && typeof body === 'object' ? (body as Record<string, unknown>).code : null;
  if (typeof code !== 'string' || !code) return invalidRequest();

  // A join is a join to a Session. Without the header there is nothing to join to, and
  // an assistant that omitted it has not sent the request section 6 describes.
  const poppySession = request.headers.get('poppy-session');
  if (!poppySession) return invalidRequest();

  const bearer = /^Bearer[ ]+(.+)$/i.exec((request.headers.get('authorization') ?? '').trim());
  const token = bearer ? bearer[1].trim() : null;

  let accessToken: string | null = null;
  if (token) {
    const { session, reason } = await inspectAgentToken(token);
    if (!session) {
      // The reason is always on the log; refusedBecause decides whether the agent hears
      // it, and says no unless this deployment asked otherwise. A silent refusal is
      // especially opaque here — nothing renders a body, just a browser that never
      // joins — which is why the endpoint honours the same flag as the API.
      return Response.json(
        { error: 'invalid_token', error_description: refusedBecause(reason) },
        {
          status: 401,
          headers: {
            'www-authenticate': 'Bearer error="invalid_token"',
            'cache-control': 'no-store',
          },
        },
      );
    }

    // "The Company MUST reject an access token in step 2 that doesn't have the
    // poppy:browser-sign-in scope, with insufficient_scope as at an API." The code is
    // left unspent, because section 6 has the assistant authorize the same code again
    // without a token rather than start over.
    if (!session.scopes.includes(SCOPE_BROWSER_SIGN_IN)) {
      return Response.json(
        {
          error: 'insufficient_scope',
          error_description: `The customer has not approved ${SCOPE_BROWSER_SIGN_IN} for this assistant.`,
        },
        {
          status: 403,
          headers: {
            'www-authenticate': `Bearer error="insufficient_scope", scope="${SCOPE_BROWSER_SIGN_IN}"`,
            'cache-control': 'no-store',
          },
        },
      );
    }

    accessToken = token;
  }

  if (!(await authorizeJoin({ code, poppySession, accessToken }))) return invalidRequest();

  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}
