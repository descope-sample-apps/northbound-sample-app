import { apiBaseUrl, SCOPE_READ, SCOPE_WRITE } from '@/lib/api/bearer';
import { DPOP_ALGS } from '@/lib/api/dpop';
import { authorizationServer } from '@/lib/api/issuer';

export const dynamic = 'force-dynamic';

/**
 * RFC 9728 protected resource metadata for the agent API.
 *
 * THE PATH IS NOT DECORATIVE. Section 3.1 inserts the well-known segment BETWEEN the
 * origin and the resource's path, so the resource https://northbound.camp/api/agent/v1
 * publishes here, at /.well-known/oauth-protected-resource/api/agent/v1 — which is the URL
 * a client builds for itself from the `servers[0].url` it read in the OpenAPI document,
 * and from the `resource_metadata` in a 401's WWW-Authenticate header. Hence the nested
 * route folders: the path has to match the resource exactly, segment for segment.
 *
 * `resource` MUST BE THAT SAME STRING. A document whose resource names something else is
 * one a client discards — it has asked about one resource and been answered about another.
 * It is built from API_BASE_PATH here for the same reason the OpenAPI document is.
 *
 * Northbound is fronted by the Agent Edge worker, which publishes the metadata for the
 * SITE at the bare /.well-known/oauth-protected-resource and forwards anything deeper to
 * this origin. Two documents, two resources: the site, which Poppy checks against
 * organization.domain, and this API, which tokens are actually minted for. They name the
 * same authorization server, which is what ties them together.
 *
 * A 404 here is survivable — an agent falls back to the token it already holds for the
 * Company — but survivable is not the same as right, and the fallback is the thing that
 * breaks first when a store later moves its API behind a different issuer.
 *
 * `resource` IS WHAT AGENTS WILL ASK DESCOPE FOR, so DESCOPE_AUDIENCE has to be this same
 * string, and so does the front door's RESOURCE. Set them to something else and a token
 * minted exactly as this document asked for is one resolveAgentToken then rejects on its
 * `aud` — a refusal with nothing in it to say that two settings disagree.
 */
export async function GET(request: Request) {
  const issuer = await authorizationServer();

  // No issuer means no useful document. Saying so with a 503 is better than publishing
  // metadata with an empty authorization_servers, which claims this resource has no
  // authorization server at all rather than that this deployment is misconfigured.
  if (!issuer) {
    return Response.json(
      {
        error: 'server_error',
        error_description:
          'Northbound cannot name its authorization server. Set DESCOPE_ISSUER, or '
          + 'DESCOPE_DISCOVERY_URL so it can be read from Descope.',
      },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }

  const resource = apiBaseUrl(request);

  return Response.json(
    {
      resource,
      resource_name: 'Northbound Agent API',
      authorization_servers: [issuer],
      // The two scopes Northbound issues, described for people in poppy.json's auth.scopes.
      scopes_supported: [SCOPE_READ, SCOPE_WRITE],
      bearer_methods_supported: ['header'],
      // RFC 9728 section 2, RFC 9449. Descope binds an agent's access token to a key when
      // the agent asks, and the token then has to arrive as `Authorization: DPoP …` with a
      // proof. Saying so here is how a client learns this store will check that proof
      // rather than quietly ignore it; `required: false` because a token the authorization
      // server did not bind is still accepted as a plain bearer token.
      dpop_signing_alg_values_supported: [...DPOP_ALGS],
      dpop_bound_access_tokens_required: false,
      resource_documentation: `${resource}/openapi.json`,
    },
    { headers: { 'cache-control': 'public, max-age=300' } },
  );
}
