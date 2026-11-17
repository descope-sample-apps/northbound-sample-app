import { descopeIssuer } from '@/lib/agentSession/descope';

/**
 * The authorization server this API's tokens come from.
 *
 * Three places have to name the same string — poppy.json's `auth.issuer`, the domain's
 * protected resource metadata, and this API's own — because an agent that finds two of
 * them disagreeing cannot tell which one the store meant. DESCOPE_ISSUER pins it (and is
 * the name Agent Edge's worker already uses for the same value, so a deployment sets one
 * thing); otherwise it comes from Descope's own discovery document, which is also where
 * the token verifier reads it.
 */
export async function authorizationServer(): Promise<string | null> {
  const pinned = process.env.DESCOPE_ISSUER ?? process.env.POPPY_ISSUER;
  if (pinned) return pinned;
  return descopeIssuer();
}

/**
 * Where OpenAPI's `openIdConnect` security scheme sends a client to find the real
 * authorization and token endpoints. The same document the token verifier already reads,
 * so there is no second copy of those URLs to go stale.
 */
export function openIdConnectUrl(): string | undefined {
  return process.env.DESCOPE_DISCOVERY_URL || undefined;
}
