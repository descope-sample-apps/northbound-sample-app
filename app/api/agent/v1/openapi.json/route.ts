import { apiBaseUrl } from '@/lib/api/bearer';
import { openIdConnectUrl } from '@/lib/api/issuer';
import { openApiDocument } from '@/lib/api/openapi';

// Read per request, not baked in at build time: the servers URL follows the host the
// document was asked for, and the issuer comes from configuration.
export const dynamic = 'force-dynamic';

/**
 * The description poppy.json's `apis` entry points at.
 *
 * Served from the API's own base path, so the document and the resource it describes are
 * the same origin and the same prefix. An agent that has fetched this learns the resource
 * identifier from `servers[0].url` — which is what it then asks for a token for, and what
 * /.well-known/oauth-protected-resource/api/agent/v1 answers about.
 */
export async function GET(request: Request) {
  return Response.json(openApiDocument(apiBaseUrl(request), openIdConnectUrl()), {
    headers: { 'cache-control': 'public, max-age=300' },
  });
}
