import { and, eq, gte, sql } from 'drizzle-orm';
import { orders } from '@/db/schema';
import { formatCents } from '@/lib/money';
import {
  parseMoneyValue, parsePeriod, purchaseGrant, type ActorContext,
} from '@/lib/oauth/types';
import { PurchaseLimitError, ValidationError } from './errors';

import type { ServiceTx } from './tx';

/**
 * Enforces the spending cap the customer approved.
 *
 * WHY THIS IS IN THE SERVICE AND NOT AT THE API EDGE
 *
 * Scope checks belong at the edge: they decide which route a token may call.
 * This is different — it is a rule about the ORDER, and it has to hold for
 * every caller. If it lived in the route, any other path to placeOrder would
 * quietly bypass it, and "the application decides what the agent may do" would
 * stop being true the first time somebody added a second entry point.
 *
 * WHERE THE LIMIT COMES FROM
 *
 * The token, and only the token. Not a header, not a parameter, not a row the
 * agent could influence — the grant is what the customer read and approved on
 * their own device, and anything else would let the agent choose its own cap.
 */
export async function assertWithinPurchaseGrant(
  tx: ServiceTx,
  ctx: ActorContext,
  totalCents: number,
): Promise<void> {
  // A customer buying for themselves has no cap. There is no third party to
  // constrain, and constraining them would be absurd.
  if (ctx.actor === null) return;

  const grant = purchaseGrant(ctx);
  if (!grant) {
    throw new PurchaseLimitError(
      'This agent is not approved to buy anything on your behalf. It has '
      + 'read-only access.',
      null, 0, totalCents,
    );
  }

  let limitCents: number;
  let windowMs: number;
  try {
    limitCents = parseMoneyValue(grant.max_amount.value);
    windowMs = parsePeriod(grant.period);
  } catch (error) {
    // A grant we cannot read is not a grant. Treating it as unlimited would be
    // the worst possible reading of an ambiguous token.
    throw new ValidationError(
      `The spending limit on this authorization could not be read: `
      + `${(error as Error).message}`,
    );
  }

  const since = new Date(Date.now() - windowMs);

  // Scoped to THIS agent. An agent cannot exhaust its allowance by counting
  // orders the customer placed themselves, or ones another agent placed.
  const [row] = await tx
    .select({ spent: sql<number>`coalesce(sum(${orders.totalCents}), 0)` })
    .from(orders)
    .where(and(
      eq(orders.customerId, ctx.customerId),
      eq(orders.agentId, ctx.actor.agentId),
      gte(orders.placedAt, since),
    ));

  const spentCents = Number(row?.spent ?? 0);

  if (spentCents + totalCents > limitCents) {
    const remaining = Math.max(0, limitCents - spentCents);

    throw new PurchaseLimitError(
      `This order is ${formatCents(totalCents)}, and you approved a limit of `
      + `${formatCents(limitCents)} per ${describePeriod(grant.period)}. `
      + (spentCents > 0
        ? `${formatCents(spentCents)} of that has already been spent, leaving `
          + `${formatCents(remaining)}.`
        : 'Approve a larger limit, or ask for a smaller order.'),
      limitCents, spentCents, totalCents,
    );
  }
}

function describePeriod(period: string): string {
  const days = /^P(\d+)D$/.exec(period)?.[1];
  if (days === '7') return 'week';
  if (days === '1') return 'day';
  if (days) return `${days} days`;
  if (period === 'P1W') return 'week';
  return period;
}
