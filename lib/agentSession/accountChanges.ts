import { getAgentSession } from '@/lib/auth/session-cookie';

/**
 * Call before changing a customer's account data. A person passes (returns undefined).
 * An AI assistant is refused.
 *
 * WHY THIS EXISTS. Northbound issues two scopes, orders:read and orders:write, and
 * until now checked them in exactly one place: orders:write at checkout. Everywhere
 * else, resolveAgentToken turned a valid token into a Customer and the scopes were
 * dropped. An assistant holding nothing but orders:read could rename the profile,
 * edit the saved shipping address, and add or delete payment methods — none of which
 * is reading an order.
 *
 * That made the discovery document untrue. It publishes orders:read as
 * `changes: "none"`, which a Personal Agent is entitled to rely on when it decides
 * what it can do without asking the customer again.
 *
 * NORTHBOUND HAS NO SCOPE FOR THIS, so the answer is no rather than a scope check.
 * Account changes are the customer's own, and an assistant that needs a different
 * address can ask them for it. A store that wants to offer this should issue a scope
 * for it (0.4 §4.7 suggests `addresses`), describe it in auth.scopes with
 * `changes: "reversible"`, and check it here instead of refusing outright.
 *
 * This is the origin's answer, independent of Agent Edge also blocking the payment
 * pages at the edge. Two layers, because the store is what the data lives in.
 */
export async function refuseAgentAccountChange(): Promise<{ error: string } | undefined> {
  if (!(await getAgentSession())) return undefined;

  return {
    error: 'An AI assistant cannot change your account details. Sign in yourself to make this change.',
  };
}
