import { sqliteTable, integer, text, unique } from 'drizzle-orm/sqlite-core';
import { customers } from './customers';

/**
 * The AI assistants that have signed in for a customer.
 *
 * One row per (customer, assistant), not one per visit — the account page answers
 * "who has been acting for me, and what can they do", which is a current-state
 * question. `firstSeenAt` is when the customer first approved it; `lastSeenAt`
 * moves on every request it makes.
 *
 * This is the customer's own record, which is why it lives in the application
 * schema rather than a log: they should be able to see an assistant they approved
 * and forgot about, including one that never bought anything.
 */
export const knownAgents = sqliteTable('known_agents', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  customerId: integer('customer_id').notNull().references(() => customers.id),

  // The token's act.sub — which assistant is acting, as distinct from the
  // customer it acts for. Matches orders.placed_by_agent, so order history and
  // this list name the same assistant the same way.
  agentId: text('agent_id').notNull(),

  // Space-separated, exactly as it arrived in the token's scope claim. Stored raw
  // so the record says what was actually granted, not a rendering of it that could
  // drift when the wording changes. Turning it into something a person can read is
  // lib/agentSession/knownAgents.ts's job.
  scope: text('scope').notNull(),

  firstSeenAt: integer('first_seen_at', { mode: 'timestamp' }).notNull(),
  lastSeenAt: integer('last_seen_at', { mode: 'timestamp' }).notNull(),
}, (table) => [unique().on(table.customerId, table.agentId)]);

export type KnownAgent = typeof knownAgents.$inferSelect;
