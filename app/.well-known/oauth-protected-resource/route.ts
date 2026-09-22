import { resolveIssuer, resourceIdentifier } from '@/lib/oauth/issuer';
import { SCOPES } from '@/lib/oauth/types';

/**
 * Protected Resource Metadata — RFC 9728.
 *
 * The first document an agent that has never heard of Northbound will read. It
 * is reached from the `resource_metadata` parameter of the WWW-Authenticate
 * challenge that every 401 from /api/* carries, and it is what lets an agent
 * find the authorization server without being told about it in advance.
 */
export async function GET(request: Request): Promise<Response> {
  const issuer = resolveIssuer(request);

  return Response.json(
    {
      resource: resourceIdentifier(issuer),
      authorization_servers: [issuer],
      scopes_supported: SCOPES,
      // Header only. A token in a query string ends up in access logs, proxy
      // logs and browser history, and nothing here needs that.
      bearer_methods_supported: ['header'],
    },
    {
      // Every URL in this document is derived from the host the request
      // arrived on. A cached copy served to a different host would point an
      // agent at the wrong authorization server.
      headers: { 'cache-control': 'no-store' },
    },
  );
}
