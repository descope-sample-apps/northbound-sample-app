// Northbound's Poppy discovery document, draft 0.3.
//
// A route rather than a file in public/, so the issuer comes from configuration
// instead of being committed.
import { NextResponse } from 'next/server';

// The issuer is read per request, not baked in at build time.
export const dynamic = 'force-dynamic';

/**
 * Draft 0.3 of the Personal Agent Protocol:
 * https://personalagentprotocol.org/docs/0.3/spec
 *
 * The version is load-bearing. Before 1.0 each draft may break the one before it, so
 * §3.1 tells a Personal Agent it MUST NOT use a document whose major.minor it doesn't
 * support. A stale `protocol_version` isn't a document an agent tolerates — it's one
 * it refuses.
 */
export async function GET() {
  return NextResponse.json({
    protocol_version: '0.3',
    organization: {
      name: 'Northbound',
      domain: 'northbound.camp',
    },
    auth: {
      // Optional in 0.3, and omitted unless configured. The issuer is normally read from
      // /.well-known/oauth-protected-resource, which 0.3 §3.2 makes the source of truth:
      // with one authorization server listed there, that server IS the issuer and naming
      // it again here is redundant. Set POPPY_ISSUER only to pick among several — and
      // then it MUST be one of them, character for character.
      ...(process.env.POPPY_ISSUER ? { issuer: process.env.POPPY_ISSUER } : {}),

      // What the customer is agreeing to when they approve an agent. Northbound has no
      // OpenAPI description for an agent to read these from, which is the case 0.3 §4.7
      // recommends auth.scopes for. They are the two scopes lib/agentSession/descope.ts
      // accepts; a token with neither doesn't sign an agent in.
      scopes: {
        'orders:read': 'See your orders and what you have in your cart',
        'orders:write': 'Place an order with your saved address and card',
      },
      // How much is at stake, so an agent can tell before it asks. `changes` is the most
      // consequential thing the scope allows, and buying is not undoable.
      scope_hints: {
        'orders:read': { changes: 'none', personal_data: true },
        'orders:write': { changes: 'irreversible', personal_data: true },
      },
    },

    // Northbound is a website, and 0.3 requires at least one of `agent`, `apis` or `web`.
    // No browser_session_endpoint: Northbound doesn't implement §6 browser join, so an
    // agent's browser arrives as an ordinary visitor and signs in through Agent Edge.
    web: {},
  });
}
