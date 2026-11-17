import { resolveAgentToken, type AgentSession } from '@/lib/agentSession/descope';
import { ServiceError } from '@/lib/services/errors';
import { resourceMetadataUrl, SCOPE_READ, SCOPE_WRITE } from './resource';

export { API_BASE_PATH, apiBaseUrl, publicOrigin, resourceMetadataUrl, SCOPE_READ, SCOPE_WRITE } from './resource';

/**
 * The agent API's transport layer: bearer tokens in, status codes out.
 *
 * lib/services/errors.ts said this would come — "Sub-project B will map the same classes
 * to status codes on the agent API" — and this is that mapping. Nothing here knows how an
 * order is placed; it authenticates the caller, checks one scope, and turns a ServiceError
 * into the status code that means the same thing. The services stay transport-free, so the
 * storefront and this API cannot drift apart.
 *
 * BEARER ONLY, NEVER THE COOKIE. The storefront resolves agents from the DS cookie the
 * front door plants in an agent's browser (lib/auth/session-cookie.ts). An API is not a
 * browser: a cookie here would make every cross-site form post an authenticated request.
 * The token arrives in the Authorization header or the request is anonymous.
 */

/** What a route needs the customer to have approved. */
export type Need = 'read' | 'write';

export function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

function quote(value: string): string {
  // auth-param values are quoted-string: backslash and quote have to be escaped or the
  // header stops parsing where the value was supposed to continue.
  return `"${value.replace(/[\\"]/g, (c) => `\\${c}`)}"`;
}

/**
 * The WWW-Authenticate challenge, carrying `resource_metadata` so a client that arrives
 * with no idea who issues tokens here can find out from the 401 itself (RFC 9728 §5.1).
 * That is the whole point of answering 401 rather than 403 to an anonymous caller.
 */
function challenge(
  request: Request,
  status: number,
  error: string | undefined,
  description: string,
  scope?: string,
): Response {
  const params = [
    error ? `error=${quote(error)}` : undefined,
    error ? `error_description=${quote(description)}` : undefined,
    scope ? `scope=${quote(scope)}` : undefined,
    `resource_metadata=${quote(resourceMetadataUrl(request))}`,
  ].filter(Boolean);

  return Response.json(
    { error: error ?? 'unauthorized', error_description: description },
    {
      status,
      headers: {
        'www-authenticate': `Bearer ${params.join(', ')}`,
        'cache-control': 'no-store',
      },
    },
  );
}

/** The token from `Authorization: Bearer …`, or null. The scheme is case-insensitive. */
function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const match = /^Bearer[ ]+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

/**
 * Whether these scopes cover what the route needs.
 *
 * orders:write satisfies a read: a customer who has let an assistant place orders with
 * their saved address and card has already allowed it to see what it is buying, and an
 * assistant that could buy but not read back what it bought would be a trap. The reverse
 * is not true — orders:read is published as `changes: "none"` and has to stay that way.
 */
export function allows(scopes: string[], need: Need): boolean {
  if (scopes.includes(SCOPE_WRITE)) return true;
  return need === 'read' && scopes.includes(SCOPE_READ);
}

/** Service errors carry a code; this is the only place it becomes a status. */
export function statusFor(error: ServiceError): number {
  switch (error.code) {
    case 'not_found': return 404;
    case 'forbidden': return 403;
    case 'invalid': return 400;
    // The request was right when it was made and the world moved: stock ran out, or the
    // price changed between the total the agent confirmed and the charge. 409, so a
    // client knows re-reading and retrying is the fix, not rewriting the request.
    case 'out_of_stock': return 409;
    case 'price_changed': return 409;
    case 'busy': return 503;
    default: return 400;
  }
}

function serviceErrorResponse(error: ServiceError): Response {
  return Response.json(
    { error: error.code, error_description: error.message },
    { status: statusFor(error), headers: { 'cache-control': 'no-store' } },
  );
}

/**
 * A route with no token at all, for the parts of the store that are public to people and
 * so are public to their assistants too. It still maps service errors to status codes, so
 * an unknown product is a 404 here exactly as it is behind a token.
 */
export function withPublic(handler: (request: Request) => Promise<Response>) {
  return async (request: Request): Promise<Response> => {
    try {
      return await handler(request);
    } catch (error) {
      if (error instanceof ServiceError) return serviceErrorResponse(error);
      throw error;
    }
  };
}

type AgentHandler<C> = (
  request: Request,
  session: AgentSession,
  context: C,
) => Promise<Response>;

/**
 * Wraps a route handler so it only ever runs for an agent the customer approved.
 *
 * Three refusals, each saying a different thing: no token at all (401, here is where to
 * get one), a token this store will not accept (401 invalid_token), and a real token that
 * was never approved for this (403 insufficient_scope, naming the scope to ask for).
 */
export function withAgent<C = unknown>(need: Need, handler: AgentHandler<C>) {
  return async (request: Request, context: C): Promise<Response> => {
    const token = bearerToken(request);
    if (!token) {
      return challenge(
        request,
        401,
        undefined,
        'This endpoint needs an access token the customer approved for their assistant.',
      );
    }

    const session = await resolveAgentToken(token);
    if (!session) {
      // resolveAgentToken has already written the reason to the log. It is deliberately
      // not repeated here: the detail that explains a rejection to an operator (which
      // claim disagreed, which customer was looked for) would tell an attacker holding a
      // stolen or forged token exactly what to change.
      return challenge(
        request,
        401,
        'invalid_token',
        'The access token is not valid for Northbound.',
      );
    }

    if (!allows(session.scopes, need)) {
      const scope = need === 'write' ? SCOPE_WRITE : SCOPE_READ;
      return challenge(
        request,
        403,
        'insufficient_scope',
        `The customer has not approved ${scope} for this assistant.`,
        scope,
      );
    }

    try {
      return await handler(request, session, context);
    } catch (error) {
      if (error instanceof ServiceError) return serviceErrorResponse(error);
      throw error;
    }
  };
}

/**
 * Reads a JSON body, or null when there isn't one.
 *
 * Null rather than a throw: a malformed body is the caller's mistake to be told about in
 * a 400, and routing it through an exception would put it in the same catch as a service
 * failure, where it would be answered as though the store had broken.
 */
export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
  } catch {
    // A body that is not JSON at all lands here, and is the same answer as one that
    // parsed into something other than an object.
  }
  return null;
}

export function badRequest(message: string): Response {
  return Response.json(
    { error: 'invalid', error_description: message },
    { status: 400, headers: { 'cache-control': 'no-store' } },
  );
}
