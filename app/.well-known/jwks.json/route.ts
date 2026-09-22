import { exportJwks } from '@/lib/oauth/keys';

/**
 * The public key set, so an agent or a downstream resource server can verify an
 * access token without a shared secret.
 *
 * exportJwks rebuilds each key field by field from an allowlist rather than
 * stripping private members from a spread, so a member added later cannot leak.
 */
export async function GET(_request: Request): Promise<Response> {
  return Response.json(await exportJwks(), {
    headers: { 'cache-control': 'public, max-age=300' },
  });
}
