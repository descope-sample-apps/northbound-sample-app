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

/**
 * Codes handed out by the Poppy browser-session page, in the minute they live.
 *
 * Section 6 splits a join across two callers that never meet: the browser gets the
 * code and a cookie, the assistant authorizes the code with a token the browser never
 * sees. Nothing can be held in memory between those requests — they can land on
 * different instances — so the half-finished join is a row.
 *
 * `joinSecretHash` is the SHA-256 of the __Host-poppy_join cookie, not the cookie. A
 * row that leaks is then not a credential: it names a code whose browser you still
 * have to be. The code itself is the lookup key and is unguessable on its own.
 */
export const browserJoinCodes = sqliteTable('browser_join_codes', {
  code: text('code').primaryKey(),
  joinSecretHash: text('join_secret_hash').notNull(),

  issuedAt: integer('issued_at', { mode: 'timestamp' }).notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),

  /** Set in step 2. Null until the assistant has authorized this code. */
  authorizedAt: integer('authorized_at', { mode: 'timestamp' }),

  /**
   * The `sid` of the Session header the assistant sent in step 2 — which Session the
   * browser is joining. Recorded rather than acted on: this store sits behind Agent
   * Edge, which verifies Session headers. See lib/agentSession/browserJoin.ts.
   */
  poppySession: text('poppy_session'),

  /**
   * The access token from step 2, when the join was a signed-in one. Server-side only:
   * section 6 is explicit that "the access token never passes through the browser",
   * so the browser gets an opaque handle and the token stays here.
   */
  accessToken: text('access_token'),

  /** Set by the first step-3 submission, whatever that submission's result. */
  consumedAt: integer('consumed_at', { mode: 'timestamp' }),
});

/**
 * A browser joined to a Session: the row behind the cookie step 3 sets.
 *
 * `id` is the SHA-256 of the cookie value, so the table holds no value that would work
 * in a browser. The access token is kept because section 6 requires the cookie to stop
 * acting for the account when the customer signs out or disconnects the assistant —
 * which means asking Descope again on every request, not trusting a snapshot taken at
 * join time.
 */
export const agentBrowserSessions = sqliteTable('agent_browser_sessions', {
  id: text('id').primaryKey(),
  poppySession: text('poppy_session').notNull(),
  accessToken: text('access_token'),

  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  revokedAt: integer('revoked_at', { mode: 'timestamp' }),
});

export type BrowserJoinCode = typeof browserJoinCodes.$inferSelect;
export type AgentBrowserSession = typeof agentBrowserSessions.$inferSelect;
