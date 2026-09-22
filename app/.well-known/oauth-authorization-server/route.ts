import { resolveIssuer } from '@/lib/oauth/issuer';
import { getAuthorizationServer } from '@/lib/oauth/server';

/** Authorization Server Metadata — RFC 8414. */
export async function GET(request: Request): Promise<Response> {
  const issuer = resolveIssuer(request);
  const metadata = getAuthorizationServer().metadata(issuer);

  return Response.json(metadata, { headers: { 'cache-control': 'no-store' } });
}
