/**
 * The base URL this authorization server calls itself.
 *
 * Everything an agent is told — `iss`, `authorization_endpoint`,
 * `resource_metadata`, the audience of every token — has to agree with the host
 * the agent actually reached. Hardcoding it breaks the moment someone runs
 * `ngrok http 3000`, which the parent specification requires to work.
 *
 * Resolution order:
 *   1. NORTHBOUND_ISSUER, for deployments behind a proxy that rewrites Host
 *   2. x-forwarded-proto / x-forwarded-host, which is what ngrok and Vercel set
 *   3. the request's own origin
 */
export function resolveIssuer(request: Request): string {
  const configured = process.env.NORTHBOUND_ISSUER;
  if (configured) return stripTrailingSlash(configured);

  const forwardedHost = request.headers.get('x-forwarded-host');
  if (forwardedHost) {
    const proto = request.headers.get('x-forwarded-proto') ?? 'https';
    return stripTrailingSlash(`${proto}://${forwardedHost.split(',')[0].trim()}`);
  }

  const host = request.headers.get('host');
  if (host) {
    const proto = host.startsWith('localhost') || host.startsWith('127.0.0.1')
      ? 'http'
      : 'https';
    return stripTrailingSlash(`${proto}://${host}`);
  }

  return stripTrailingSlash(new URL(request.url).origin);
}

/** The resource identifier tokens are minted for. */
export function resourceIdentifier(issuer: string): string {
  return `${issuer}/api`;
}

function stripTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}
