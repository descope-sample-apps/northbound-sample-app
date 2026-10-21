// Northbound's Poppy discovery document.
//
// A route rather than a file in public/, so the issuer comes from configuration
// instead of being committed.
import { NextResponse } from 'next/server';

// The issuer is read per request, not baked in at build time.
export const dynamic = 'force-dynamic';

/**
 * Fails closed: with no POPPY_ISSUER there is no issuer to name, and no document
 * is better than one pointing at an unconfigured one.
 */
export async function GET() {
  const issuer = process.env.POPPY_ISSUER;
  if (!issuer) return new NextResponse('Not Found', { status: 404 });

  return NextResponse.json({
    protocol_version: '0.1',
    organization: {
      name: 'Northbound',
      domain: 'northbound.camp',
    },
    auth: {
      issuer,
      device: {
        scopes: ['openid'],
      },
    },
    web: {},
  });
}
