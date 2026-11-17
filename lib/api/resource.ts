/**
 * What the agent API is called and where it lives.
 *
 * Constants and URL arithmetic only — no database, no token verification, nothing that
 * imports the agent code. The discovery document needs the API's URL to advertise it and
 * is required to stay a published file rather than an entry point (test/boundaries.test.ts),
 * so the thing it needs has to be reachable without dragging a token verifier behind it.
 */

/**
 * Where the agent API lives. One constant, because the routes, the OpenAPI document's
 * `servers` entry, poppy.json's `apis` entry and the protected resource metadata's
 * `resource` all have to be the same string — an agent that finds them disagreeing stops
 * rather than guesses.
 */
export const API_BASE_PATH = '/api/agent/v1';

export const SCOPE_READ = 'orders:read';
export const SCOPE_WRITE = 'orders:write';

/**
 * The origin agents reached this site on.
 *
 * Northbound runs behind the Agent Edge worker and then Vercel, so `request.url` carries
 * the internal URL and the public host arrives in x-forwarded-host. PUBLIC_ORIGIN pins it
 * for a deployment that would rather not trust a header at all.
 *
 * A forged x-forwarded-host only ever rewrites the forger's own copy of these documents:
 * agents check that the APIs a site advertises are on the site they opened (Poppy 0.4
 * section 3.2), so a document naming somewhere else is one they refuse.
 */
export function publicOrigin(request: Request): string {
  const pinned = process.env.PUBLIC_ORIGIN;
  if (pinned) return pinned.replace(/\/+$/, '');

  const url = new URL(request.url);
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const host = forwardedHost || url.host;
  const proto = forwardedProto || url.protocol.replace(/:$/, '');
  return `${proto}://${host}`;
}

/** The resource identifier this API is known by: the string tokens are minted for. */
export function apiBaseUrl(request: Request): string {
  return `${publicOrigin(request)}${API_BASE_PATH}`;
}

/**
 * Where this resource's metadata lives, per RFC 9728 section 3.1: the well-known segment
 * goes BETWEEN the origin and the resource's path, so https://northbound.camp/api/agent/v1
 * publishes at https://northbound.camp/.well-known/oauth-protected-resource/api/agent/v1.
 * Appending the well-known path to the resource instead would be a URL nobody looks at.
 */
export function resourceMetadataUrl(request: Request): string {
  return `${publicOrigin(request)}/.well-known/oauth-protected-resource${API_BASE_PATH}`;
}
