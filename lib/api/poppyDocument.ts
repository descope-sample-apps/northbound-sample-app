/**
 * Northbound's Poppy discovery document, in one place because it is served twice.
 *
 * §3.4 lets a Company serve several protocol versions at once so agents move at their own
 * pace: `poppy.json` is the version the store prefers, and `supported_versions` maps each
 * older one to its own URL. That is two routes publishing almost the same document, and
 * the spec is strict about what MUST match between them — the same `organization.domain`
 * and the same issuer, so a version bump never changes who the Company is, and with it
 * every User ID and refresh token. Building both from one function is what makes that
 * true by construction rather than by two files being edited together.
 *
 * Constants and URL arithmetic only. This document stays a published file, not an entry
 * point: lib/api/resource.ts imports no database and no token verifier, so advertising
 * the API does not pull the agent code in behind it.
 */
import { API_BASE_PATH, organizationDomain, publicOrigin } from './resource';

/** The version Northbound prefers, served at /.well-known/poppy.json. */
export const POPPY_VERSION = '1.0';

/**
 * Older versions still served, each at its own URL.
 *
 * THIS IS WHY A BUMP IS NOT A DOOR CLOSING. Before 1.0 two versions are compatible only
 * on an exact major.minor match (§3.4), so an agent that speaks 0.4 does not read a 1.0
 * document and ignore what it does not know — it refuses it outright. Serving 0.4 beside
 * 1.0 is the difference between upgrading and cutting off every agent that has not caught
 * up yet.
 */
export const LINKED_VERSIONS = ['0.4'] as const;

/** Where a linked version's document lives. §3.4 lets this path be anything. */
export function linkedVersionPath(version: string): string {
  return `/poppy/${version}.json`;
}

/**
 * The document for one protocol version.
 *
 * `supported_versions` appears only on the preferred version's document: "The document
 * there has the protocol_version it is listed under, and no supported_versions" (§3.4).
 * An agent does not follow a chain of documents.
 */
export function poppyDocument(request: Request, version: string): Record<string, unknown> {
  const origin = publicOrigin(request);

  return {
    protocol_version: version,

    // EVERY LINKED URL MUST BE HTTPS (§3.4), and a dev server is not. Rather than publish
    // a URL the spec forbids, a store reached over http simply offers the one version.
    // The link is a promise about where an older document lives, and http is not a place
    // it may live.
    ...(version === POPPY_VERSION && origin.startsWith('https://')
      ? {
          supported_versions: Object.fromEntries(
            LINKED_VERSIONS.map((v) => [v, `${origin}${linkedVersionPath(v)}`]),
          ),
        }
      : {}),

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
      // the customer is being asked to allow.
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
    // THE SAME ENDPOINT IN BOTH VERSIONS, because §6's join is identical in 0.4 and 1.0:
    // the same three requests, the same code-and-cookie pair, the same scope.
    //
    // NO `unscoped`. That flag is for a website where `poppy:browser-sign-in` means
    // everything the account can do. Here checkout still sends an agent without
    // orders:write to the front door (lib/agentSession/stepUp.ts), account changes are
    // refused (lib/agentSession/accountChanges.ts), and reading is covered because every
    // token this store accepts already carries a read scope (lib/agentSession/descope.ts,
    // pinned by test/agent-session.test.ts). Claiming otherwise would ask customers to
    // approve far more than this grants.
    web: {
      browser_session_endpoint: `${origin}/poppy/browser-session`,
    },

    // WHAT MAKES THE SESSION SPENDABLE. `web` on its own would say an agent may browse
    // Northbound and nothing more: a Session opened against this document had nowhere to
    // be used, so an agent sent to buy something signed the customer in and then refused,
    // because no URL here was one the site had vouched for.
    //
    // ABSOLUTE, NOT A PATH. Agents resolve this URL and check it is on the site they
    // opened; a relative URL is rejected outright rather than resolved against the
    // document, so it has to carry the scheme and host it was served on.
    apis: [
      {
        type: 'openapi',
        url: `${origin}${API_BASE_PATH}/openapi.json`,
        description: 'Browse the catalog, build the cart, and place and track orders',
      },
    ],
  };
}
