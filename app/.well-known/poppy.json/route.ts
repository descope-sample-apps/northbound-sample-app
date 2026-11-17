// Northbound's Poppy discovery document, draft 0.4.
//
// A route rather than a file in public/, so the issuer comes from configuration
// instead of being committed.
import { NextResponse } from 'next/server';
// Constants and URL arithmetic only. This document stays a published file, not an entry
// point: lib/api/resource.ts imports no database and no token verifier, so advertising
// the API does not pull the agent code in behind it.
import { API_BASE_PATH, organizationDomain, publicOrigin } from '@/lib/api/resource';

// The issuer is read per request, not baked in at build time.
export const dynamic = 'force-dynamic';

/**
 * Draft 0.4 of the Personal Agent Protocol:
 * https://personalagentprotocol.org/docs/0.4/spec
 *
 * The version is load-bearing. Before 1.0, two versions are compatible only when their
 * major AND minor match (§3.4), so an agent that speaks 0.4 doesn't downgrade to a 0.3
 * document — it declines to use it. A stale `protocol_version` isn't a document an
 * agent tolerates, it's one it refuses.
 *
 * 0.4 adds `supported_versions` for serving older drafts alongside this one, each at
 * its own URL on this host. Northbound serves one version; a store with agents already
 * integrated would add it rather than cut them off on a draft bump.
 */
export async function GET(request: Request) {
  return NextResponse.json({
    protocol_version: '0.4',
    organization: {
      name: 'Northbound',
      // Read off the same origin the API URLs below are built from, so the document
      // cannot name one host and then advertise an API on another — on production, on a
      // preview deployment, or on a dev server.
      domain: organizationDomain(request),
    },
    auth: {
      // Optional, and omitted unless configured. The issuer is normally read from
      // /.well-known/oauth-protected-resource, which §3.2 makes the source of truth:
      // with one authorization server listed there, that server IS the issuer and naming
      // it again here is redundant. Set POPPY_ISSUER only to pick among several — and
      // then it MUST be one of them, character for character.
      ...(process.env.POPPY_ISSUER ? { issuer: process.env.POPPY_ISSUER } : {}),

      // What the customer is agreeing to when they approve an agent, in the words they
      // approve them in. §4.7 keeps these here even now that the API below describes its
      // own scopes: an OpenAPI document says which operation needs which scope, not what
      // the customer is being asked to allow. They are the two scopes
      // lib/agentSession/descope.ts accepts; a token with neither doesn't sign an agent in.
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

    // A website, and §3.1 requires at least one of `agent`, `apis` or `web`.
    //
    // No `browser_session_endpoint`: Northbound doesn't implement §6 browser join. Its
    // agents reach the site through Agent Edge's own cookie instead, which is why there
    // is no `poppy:browser-sign-in` scope above — 0.4 ties that scope to this endpoint,
    // and a Personal Agent only requests it from a store that lists one.
    web: {},

    // WHAT MAKES THE SESSION SPENDABLE. `web: {}` on its own says an agent may browse
    // Northbound signed out, and nothing more: a Session opened against this document had
    // nowhere to be used, so an agent sent to buy something signed the customer in and
    // then refused, because no URL here was one the site had vouched for.
    //
    // ABSOLUTE, NOT A PATH. Agents resolve this URL and check it is on the site they
    // opened; a relative URL is rejected outright rather than resolved against the
    // document, so it has to carry the scheme and host it was served on.
    apis: [
      {
        type: 'openapi',
        url: `${publicOrigin(request)}${API_BASE_PATH}/openapi.json`,
        description: 'Browse the catalog, build the cart, and place and track orders',
      },
    ],
  });
}
