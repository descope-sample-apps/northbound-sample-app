/**
 * Every scope this resource understands, exactly as the parent specification
 * lists them. The tuple is the single source of truth: metadata advertises it,
 * registration validates against it, and the bearer guard checks membership.
 */
export const SCOPES = [
  'products.read',
  'orders.read',
  'cart.read',
  'cart.write',
  'checkout',
  'profile.read',
  'addresses.write',
  'payment_methods.write',
] as const;

export type Scope = (typeof SCOPES)[number];

export function isScope(value: string): value is Scope {
  return (SCOPES as readonly string[]).includes(value);
}

/**
 * A Rich Authorization Request detail — RFC 9396.
 *
 * EXTENSION NOTICE. RFC 9396 defines `type` and leaves every other field to the
 * API designer. `maximum_amount` and `currency` are Northbound's own, and
 * `maximum_amount` is a STRING IN MINOR UNITS ("10000" means $100.00).
 *
 * A bare integer would be ambiguous about units, and a float would be a
 * rounding bug waiting to happen. This choice is documented in the README and
 * in auth.md so nobody mistakes it for something standardised.
 */
export type CheckoutAuthorizationDetail = {
  type: 'checkout';
  maximum_amount: string;
  currency: string;
};

export type AuthorizationDetail = CheckoutAuthorizationDetail;

/** Claims carried by an issued access token. */
export type AccessTokenClaims = {
  iss: string;
  sub: string;
  /**
   * RFC 8693's actor claim, used for its defined meaning: the party acting on
   * behalf of the subject. Absent when the customer obtained the token
   * directly. `sub` is always the customer — the agent NEVER becomes the user.
   */
  act?: { sub: string };
  client_id: string;
  aud: string;
  scope: string;
  authorization_details?: AuthorizationDetail[];
  jti: string;
  iat: number;
  exp: number;
};

/**
 * Who an operation is for, and who is performing it.
 *
 * This is the boundary sub-project A deliberately did not have. Every service
 * function takes one. The storefront builds one with `actor: null`; the API
 * builds one from a token. Both then call the same code, which is what makes
 * "the application decides what the agent may do" true in the implementation
 * rather than only in the diagram.
 *
 * It CARRIES scopes but does not ENFORCE them. Enforcement happens at the API
 * edge, and later in the policy engine. A service that silently ignored a
 * missing scope would be worse than one that never saw it.
 */
export type ActorContext = {
  customerId: number;
  actor: { agentId: string; clientId: string } | null;
  scopes: Scope[];
  authorizationDetails: AuthorizationDetail[];
  source: 'browser' | 'api';
};

/** The context a signed-in human gets. No actor, no scopes, no constraints. */
export function browserContext(customerId: number): ActorContext {
  return {
    customerId,
    actor: null,
    scopes: [],
    authorizationDetails: [],
    source: 'browser',
  };
}

export function isAgentContext(
  ctx: ActorContext,
): ctx is ActorContext & { actor: { agentId: string; clientId: string } } {
  return ctx.actor !== null;
}
