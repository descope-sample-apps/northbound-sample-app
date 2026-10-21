// Northbound's Poppy discovery document.
//
// A route rather than a file in public/, so the issuer comes from configuration
// instead of being committed. It is derived from DESCOPE_DISCOVERY_URL — the same
// variable lib/agentSession/descope.ts verifies agent tokens against — so the
// document cannot advertise one issuer while the store trusts another.
import { NextResponse } from 'next/server';

// The issuer is read per request, not baked in at build time.
export const dynamic = 'force-dynamic';

/**
 * Descope's inbound app issuer is its discovery URL without the well-known suffix.
 * A URL that doesn't carry that suffix is returned unchanged.
 */
export function issuerFromDiscoveryUrl(discoveryUrl: string): string {
  return discoveryUrl.trim().replace(/\/\.well-known\/openid-configuration\/?$/, '');
}

/**
 * Fails closed, as resolveAgentToken does: with no DESCOPE_DISCOVERY_URL there is no
 * issuer to name, and no document is better than one pointing at an unconfigured one.
 */
export async function GET() {
  const discoveryUrl = process.env.DESCOPE_DISCOVERY_URL;
  if (!discoveryUrl) return new NextResponse('Not Found', { status: 404 });

  return NextResponse.json({
    protocol_version: '0.1',
    organization: {
      name: 'Northbound',
      domain: 'northbound.camp',
    },
    auth: {
      issuer: issuerFromDiscoveryUrl(discoveryUrl),
      device: {
        scopes: ['openid'],
      },
    },
    web: {},
  });
}
