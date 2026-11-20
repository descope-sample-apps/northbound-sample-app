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
 * The domain Northbound publishes as `organization.domain`.
 *
 * Every URL in the discovery documents has to be on this host. Poppy 0.4 (3.2) has an
 * agent derive the site from `organization.domain` and check what it is offered against
 * it, and "www.northbound.camp" is not a match for "northbound.camp" — an agent sent to
 * either one is looking for the apex.
 */
export const ORGANIZATION_DOMAIN = 'northbound.camp';

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

  // THROUGH URL BEFORE COMPARING ANYTHING. A host is case-insensitive and carries an
  // implied port, so "WWW.Northbound.camp" and "northbound.camp:443" are this site said
  // two other ways. Comparing the raw header to a lowercase literal misses both, and the
  // miss is silent: the document goes out naming a host organization.domain does not.
  // `new URL` lowercases the host and drops the port when it is the scheme's default,
  // which is the whole normalization, done by the parser rather than by hand here.
  const origin = normalizedOrigin(
    forwardedProto || url.protocol.replace(/:$/, ''),
    forwardedHost || url.host,
  ) ?? url.origin;

  // THE DOCUMENTS FOLLOW organization.domain, NOT THE PROXY. Vercel reported
  // x-forwarded-host: www.northbound.camp even for requests to the apex, which published
  // an OpenAPI document whose servers URL named a host the discovery document does not —
  // a document that contradicts itself, and a resource identifier for somewhere else.
  //
  // The host still decides, because a preview deployment and a local dev server have to
  // describe themselves; it is only canonicalized when it IS this site, under either
  // spelling. A site that genuinely lives on www says so in ORGANIZATION_DOMAIN.
  const { host } = new URL(origin);
  if (host === ORGANIZATION_DOMAIN || host === `www.${ORGANIZATION_DOMAIN}`) {
    return `https://${ORGANIZATION_DOMAIN}`;
  }

  return origin;
}

/**
 * `proto://host` as a URL origin, or null when the two do not make one.
 *
 * A forwarded header is attacker-supplied in principle, so a value that is not a host at
 * all must not throw its way out of a discovery document and into a 500. The caller falls
 * back to the request's own origin, which is the one thing here that cannot be forged.
 */
function normalizedOrigin(proto: string, host: string): string | null {
  try {
    return new URL(`${proto}://${host}`).origin;
  } catch {
    return null;
  }
}

/**
 * What `organization.domain` says, which is the host everything else in the document is
 * on — because it is read off the same origin they are built from.
 *
 * Poppy 0.4 (3.2) has an agent check this field against the host that served the
 * document, so a constant would be right only where the constant IS the host. On
 * northbound.camp it is: publicOrigin canonicalizes both spellings to ORGANIZATION_DOMAIN,
 * and the worker in front redirects www to the apex before this route is reached at all.
 * Anywhere else — a preview deployment, a dev server — a hardcoded domain would publish a
 * document claiming to be northbound.camp's while advertising APIs on the host it was
 * actually served from, which is the same self-contradiction this file exists to prevent.
 */
export function organizationDomain(request: Request): string {
  return new URL(publicOrigin(request)).host;
}

/**
 * The URL a DPoP proof has to name: origin and path, no query, no fragment (RFC 9449
 * section 4.2).
 *
 * BUILT FROM publicOrigin, NOT FROM request.url. Northbound sits behind the Agent Edge
 * worker and then Vercel, so request.url carries the internal URL while the agent signed
 * its proof over the public one. Comparing against request.url would refuse every proof
 * in production and accept every proof on a dev server, which is the worst way round.
 */
export function requestTarget(request: Request): string {
  return `${publicOrigin(request)}${new URL(request.url).pathname}`;
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
