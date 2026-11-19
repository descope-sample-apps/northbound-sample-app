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
        // §6's scope, in the words it is approved in. Northbound's website applies the
        // cookie's scopes rather than treating this as the run of the account, so it
        // allows nothing the two above don't — which is exactly what it has to say.
        'poppy:browser-sign-in':
          'Browse the store signed in to your account, doing only what the permissions above allow',
      },
      // How much is at stake, so an agent can tell before it asks. `changes` is the most
      // consequential thing the scope allows, and buying is not undoable.
      scope_hints: {
        'orders:read': { changes: 'none', personal_data: true },
        'orders:write': { changes: 'irreversible', personal_data: true },
        // Nothing on its own: signing the browser in is not itself a change, and what
        // the browser may then do is whatever the other scopes already said.
        'poppy:browser-sign-in': { changes: 'none', personal_data: true },
      },
    },

    // A website, and §3.1 requires at least one of `agent`, `apis` or `web`.
    //
    // LISTING THIS IS A PROMISE, NOT A HINT. §6: once a Company lists the endpoint, a
    // Personal Agent MUST join its browser to a Session before browsing the website. An
    // agent that has read this document and finds nothing at the URL has lost browsing
    // that worked before, so the field goes in only alongside a route that answers —
    // app/poppy/browser-session, which test/poppy-discovery.test.ts checks is there.
    //
    // NO `unscoped`. That flag is for a website where `poppy:browser-sign-in` means
    // everything the account can do. Here checkout still sends an agent without
    // orders:write to the front door (lib/agentSession/stepUp.ts) and account changes
    // are still refused (lib/agentSession/accountChanges.ts), so the cookie's scopes
    // apply, and claiming otherwise would ask customers to approve far more than this
    // grants.
    web: {
      browser_session_endpoint: `${publicOrigin(request)}/poppy/browser-session`,
    },

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
