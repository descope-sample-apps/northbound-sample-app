import { eq, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { knownAgents, orders } from '@/db/schema';

/**
 * The customer's record of which AI assistants have acted for them.
 *
 * Northbound already stored `orders.placed_by_agent`, so order history could say an
 * assistant bought something. That only ever showed assistants that reached checkout.
 * An assistant that signed in, read the order history and left appeared nowhere, which
 * is precisely the one a customer would want to find. This module records every
 * assistant that signs in, whether or not it buys.
 */

/**
 * What each scope lets an assistant do, in the words the customer is shown.
 *
 * These are the same sentences as the `auth.scopes` descriptions in the Poppy
 * discovery document (app/.well-known/poppy.json/route.ts). The store should not
 * tell a Personal Agent one thing and its own customer another.
 *
 * An unrecognized scope is shown as itself rather than dropped: a customer reading
 * this list is owed everything that was granted, including something this build
 * doesn't have wording for.
 */
const PLAIN_ENGLISH: Record<string, string> = {
  'orders:read': 'See your orders and what you have in your cart',
  'orders:write': 'Place an order with your saved address and card',
};

function describe(scope: string): string[] {
  return scope.split(' ').filter(Boolean).map((s) => PLAIN_ENGLISH[s] ?? s);
}

/**
 * Notes that an assistant acted for this customer, on every request it makes.
 *
 * BEST EFFORT, DELIBERATELY. A failure here is logged and swallowed rather than
 * rejecting the request. The trade runs the other way from token validation: refusing
 * to serve a customer's assistant because an audit row would not write is a worse
 * outcome than a gap in the list. A store that treats this as a compliance record
 * rather than a convenience should make it fail closed instead.
 */
export async function recordAgentVisit(
  customerId: number,
  agentId: string,
  scopes: string[],
): Promise<void> {
  const now = new Date();
  const scope = scopes.join(' ');

  try {
    await db
      .insert(knownAgents)
      .values({ customerId, agentId, scope, firstSeenAt: now, lastSeenAt: now })
      .onConflictDoUpdate({
        target: [knownAgents.customerId, knownAgents.agentId],
        // firstSeenAt is never updated: it is when this customer first approved
        // this assistant, and that does not happen twice.
        set: { lastSeenAt: now, scope },
      });
  } catch (error) {
    console.warn(JSON.stringify({ event: 'agent_visit_not_recorded', reason: String(error) }));
  }
}

export type Assistant = {
  /** The token's act.sub. Shown as-is: it is the only name the customer can match against Descope. */
  id: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  /** What it is currently allowed to do, one sentence per permission. */
  allowed: string[];
  /** Orders it placed, from orders.placed_by_agent. */
  ordersPlaced: number;
};

/** Most recently active first — the one a customer is looking for is the one that just acted. */
export async function listAssistants(customerId: number): Promise<Assistant[]> {
  const rows = await db
    .select({
      agentId: knownAgents.agentId,
      scope: knownAgents.scope,
      firstSeenAt: knownAgents.firstSeenAt,
      lastSeenAt: knownAgents.lastSeenAt,
      ordersPlaced: sql<number>`(
        select count(*) from ${orders}
        where ${orders.placedByAgent} = ${knownAgents.agentId}
          and ${orders.customerId} = ${knownAgents.customerId}
      )`,
    })
    .from(knownAgents)
    .where(eq(knownAgents.customerId, customerId))
    .orderBy(sql`${knownAgents.lastSeenAt} desc`);

  return rows.map((row) => ({
    id: row.agentId,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    allowed: describe(row.scope),
    ordersPlaced: Number(row.ordersPlaced),
  }));
}

/** Test seam: the same wording the discovery document publishes. */
export const scopeDescriptions = PLAIN_ENGLISH;
