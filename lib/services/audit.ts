import { desc, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { auditEvents, type AuditEvent } from '@/db/schema';
import { formatCents } from '@/lib/money';
import type { ActorContext } from '@/lib/oauth/types';
import type { ServiceTx } from './tx';

type Action = AuditEvent['action'];

/**
 * Records what happened, naming both parties.
 *
 * Takes an optional transaction handle so an event written during checkout
 * commits or rolls back with the order it describes — an audit row for an
 * order that never existed would be worse than no row at all.
 */
export async function record(
  ctx: ActorContext,
  event: {
    action: Action;
    summary: string;
    orderNumber?: number;
    amountCents?: number;
    /**
     * Names an agent the event is ABOUT rather than one that caused it.
     *
     * A revocation is done BY the customer and concerns an agent, so the row
     * carries the agent's name while `agentId` stays null — which is what keeps
     * it badged as the customer's own action in the log.
     */
    agentDisplayName?: string;
  },
  tx?: ServiceTx & { insert: typeof db.insert },
): Promise<void> {
  const handle = tx ?? db;

  await handle.insert(auditEvents).values({
    customerId: ctx.customerId,
    agentId: ctx.actor?.agentId ?? null,
    agentDisplayName: event.agentDisplayName ?? ctx.actor?.agentId ?? null,
    action: event.action,
    summary: event.summary,
    orderNumber: event.orderNumber ?? null,
    amountCents: event.amountCents ?? null,
    createdAt: new Date(),
  });
}

/** Everything that happened on this account, newest first. */
export async function listActivity(
  ctx: ActorContext,
  options: { agentId?: string; limit?: number } = {},
): Promise<AuditEvent[]> {
  const rows = await db.select().from(auditEvents)
    .where(eq(auditEvents.customerId, ctx.customerId))
    .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
    .limit(options.limit ?? 100);

  return options.agentId
    ? rows.filter((row) => row.agentId === options.agentId)
    : rows;
}

/** Agents that have ever acted on this account, with their last activity. */
export async function listAgentsSeen(ctx: ActorContext): Promise<Array<{
  agentId: string;
  displayName: string;
  lastSeen: Date;
  eventCount: number;
}>> {
  const rows = await listActivity(ctx, { limit: 1000 });
  const byAgent = new Map<string, { displayName: string; lastSeen: Date; count: number }>();

  for (const row of rows) {
    if (!row.agentId) continue;
    const existing = byAgent.get(row.agentId);
    if (existing) {
      existing.count += 1;
      if (row.createdAt > existing.lastSeen) existing.lastSeen = row.createdAt;
    } else {
      byAgent.set(row.agentId, {
        displayName: row.agentDisplayName ?? row.agentId,
        lastSeen: row.createdAt,
        count: 1,
      });
    }
  }

  return [...byAgent.entries()]
    .map(([agentId, value]) => ({
      agentId,
      displayName: value.displayName,
      lastSeen: value.lastSeen,
      eventCount: value.count,
    }))
    .sort((a, b) => b.lastSeen.getTime() - a.lastSeen.getTime());
}

/**
 * Turns an event into the sentence the activity page shows.
 *
 * The blog's example is the target:
 *   "Shopping Assistant, acting on behalf of Alice, requested a $900 checkout.
 *    Alice approved. Order #10241 placed."
 *
 * A customer's own action reads without an actor, so the difference between
 * the two is visible side by side rather than needing a column to decode.
 */
export function describe(event: AuditEvent, customerName: string): string {
  const who = event.agentDisplayName
    ? `${event.agentDisplayName}, acting on behalf of ${customerName},`
    : `${customerName}`;

  const amount = event.amountCents !== null ? formatCents(event.amountCents) : null;

  switch (event.action) {
    case 'grant_requested':
      return `${who} asked for access.`;
    case 'grant_approved':
      return `${customerName} approved ${event.agentDisplayName ?? 'an agent'}.`;
    case 'grant_denied':
      return `${customerName} declined ${event.agentDisplayName ?? 'an agent'}.`;
    case 'order_placed':
      return `${who} placed order #${event.orderNumber}${amount ? ` for ${amount}` : ''}.`;
    case 'order_refused':
      return `${who} tried to place${amount ? ` a ${amount}` : ''} order. ${event.summary}`;
    case 'step_up_requested':
      return `${who} requested${amount ? ` a ${amount}` : ''} checkout, which needs approval.`;
    case 'step_up_approved':
      return `${customerName} approved${amount ? ` the ${amount}` : ' the'} order.`;
    case 'agent_refused':
      return `${who} attempted something agents are not allowed to do. ${event.summary}`;
    case 'access_revoked':
      return `${customerName} revoked ${event.agentDisplayName ?? 'an agent'}'s access.`;
    default:
      return event.summary;
  }
}
