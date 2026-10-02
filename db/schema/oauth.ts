import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';
import { customers } from './customers';

/**
 * The agent registry.
 *
 * Note what is NOT here: there is no `agent_user` table and no parallel account
 * of any kind. An agent is a distinct actor that acts FOR a customer who
 * already existed before any of this was built. That is the entire thesis of
 * the project, and the schema is where it either holds or quietly stops being
 * true.
 */
export const agents = sqliteTable('agents', {
  id: text('id').primaryKey(),
  displayName: text('display_name').notNull(),
  logoPath: text('logo_path'),
  owner: text('owner').notNull(),
  description: text('description'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

/**
 * Clients registered through RFC 7591 dynamic registration.
 *
 * Registration is OPEN — anybody can register — which is correct for a demo an
 * arbitrary agent is meant to be able to drive, and wrong for production. The
 * registration response says so out loud rather than leaving it implied.
 */
export const oauthClients = sqliteTable('oauth_clients', {
  clientId: text('client_id').primaryKey(),
  // Hashed with the same scrypt helper used for customer passwords. A database
  // read must not hand somebody a working client credential.
  clientSecretHash: text('client_secret_hash'),
  agentId: text('agent_id').notNull().references(() => agents.id),
  clientName: text('client_name').notNull(),
  logoUri: text('logo_uri'),
  /** JSON array. Matched character-for-character at authorize time. */
  redirectUris: text('redirect_uris').notNull(),
  grantTypes: text('grant_types').notNull(),
  tokenEndpointAuthMethod: text('token_endpoint_auth_method', {
    enum: ['none', 'client_secret_basic', 'client_secret_post'],
  }).notNull(),
  scope: text('scope'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

/** A pending authorization, between /oauth/authorize and the consent decision. */
export const authorizationRequests = sqliteTable('authorization_requests', {
  id: text('id').primaryKey(),
  clientId: text('client_id').notNull().references(() => oauthClients.clientId),
  customerId: integer('customer_id').references(() => customers.id),
  redirectUri: text('redirect_uri').notNull(),
  scope: text('scope').notNull(),
  state: text('state'),
  codeChallenge: text('code_challenge').notNull(),
  codeChallengeMethod: text('code_challenge_method', { enum: ['S256'] }).notNull(),
  authorizationDetails: text('authorization_details'),
  resource: text('resource'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  approvedAt: integer('approved_at', { mode: 'timestamp' }),
});

/**
 * Issued authorization codes.
 *
 * Stored hashed, single-use (`consumedAt`), short-lived, and bound to the
 * client, redirect URI and PKCE challenge that requested them. Every one of
 * those four properties is load-bearing; dropping any makes the code
 * replayable by somebody who merely observed it.
 */
export const authorizationCodes = sqliteTable('authorization_codes', {
  codeHash: text('code_hash').primaryKey(),
  requestId: text('request_id').notNull().references(() => authorizationRequests.id),
  clientId: text('client_id').notNull().references(() => oauthClients.clientId),
  customerId: integer('customer_id').notNull().references(() => customers.id),
  scope: text('scope').notNull(),
  codeChallenge: text('code_challenge').notNull(),
  authorizationDetails: text('authorization_details'),
  redirectUri: text('redirect_uri').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  consumedAt: integer('consumed_at', { mode: 'timestamp' }),
});

/**
 * Issuance records for access and refresh tokens.
 *
 * Access tokens are self-contained JWTs, so this row is not needed to verify
 * one — it is needed to REVOKE one. A purely stateless token cannot be
 * withdrawn, and /oauth/revoke and /oauth/introspect could not answer honestly
 * without it.
 *
 * `parentId` chains refresh tokens across rotations, so presenting a rotated
 * token can revoke every descendant at once.
 */
export const tokens = sqliteTable('tokens', {
  id: text('id').primaryKey(),
  kind: text('kind', { enum: ['access', 'refresh'] }).notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  jti: text('jti').notNull(),
  /**
   * The OAuth client, when there is one.
   *
   * NULL for a token issued through Northbound's own backchannel: in that flow
   * the agent is not an OAuth client at all — Northbound is, holding one
   * Descope client per agent platform. `agentId` is what identifies the actor
   * on that path.
   */
  clientId: text('client_id').references(() => oauthClients.clientId),
  agentId: text('agent_id').references(() => agents.id),
  customerId: integer('customer_id').references(() => customers.id),
  scope: text('scope').notNull(),
  authorizationDetails: text('authorization_details'),
  parentId: text('parent_id'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  revokedAt: integer('revoked_at', { mode: 'timestamp' }),
});

export type Agent = typeof agents.$inferSelect;
export type OAuthClient = typeof oauthClients.$inferSelect;
export type AuthorizationRequest = typeof authorizationRequests.$inferSelect;
export type AuthorizationCode = typeof authorizationCodes.$inferSelect;
export type TokenRecord = typeof tokens.$inferSelect;

/**
 * Pending CIBA (backchannel) authorizations.
 *
 * Separate from `authorizationRequests` because CIBA has neither a redirect URI
 * nor a PKCE challenge — there is no browser in the loop on the agent's side.
 * Overloading one table would have meant making both of those nullable and
 * losing the constraint that makes the authorization-code path safe.
 *
 * The agent's identity is DENORMALISED onto the row on purpose. The consent
 * screen and the audit log both have to say who asked, and both must keep
 * saying it correctly even if the platform registry changes afterwards. What
 * the customer approved is a fact about that moment.
 */
export const backchannelRequests = sqliteTable('backchannel_requests', {
  /** The `auth_req_id` the agent polls with. */
  id: text('id').primaryKey(),
  clientId: text('client_id'),
  agentId: text('agent_id').references(() => agents.id),

  agentDisplayName: text('agent_display_name').notNull(),
  agentTier: text('agent_tier', {
    enum: ['verified-trusted', 'verified-unknown', 'declared', 'unverified'],
  }).notNull(),
  agentVerified: integer('agent_verified', { mode: 'boolean' }).notNull(),
  agentDirectoryUrl: text('agent_directory_url'),
  /**
   * The key that signed the original request, when there was one.
   *
   * Polling must present a signature from the SAME key. Otherwise auth_req_id
   * is a bearer secret on its own, and anyone who observed it could collect a
   * token the customer approved for somebody else.
   */
  agentKeyId: text('agent_key_id'),

  /** The address the agent asserted. Unverified until it matches a customer. */
  loginHint: text('login_hint').notNull(),
  /** Resolved customer, or NULL when the hint matched nobody. */
  customerId: integer('customer_id').references(() => customers.id),

  scope: text('scope').notNull(),
  /** The sentence the customer reads before approving. */
  bindingMessage: text('binding_message').notNull(),
  authorizationDetails: text('authorization_details'),

  /**
   * Set when this is a step-up for one specific order rather than a standing
   * grant.
   *
   * A fingerprint rather than an order id, because the order does not exist
   * yet — the whole point is that it cannot be placed until this is approved.
   * It covers the customer, the agent, the exact total, the destination and
   * the basket, so approving one order authorises that order and nothing else.
   */
  stepUpFingerprint: text('step_up_fingerprint'),

  /**
   * `consumed` is distinct from `expired` on purpose: one means the agent
   * collected the grant, the other means nobody did before the window closed.
   * Both are dead to a poller, but the activity log needs to tell them apart.
   */
  status: text('status', {
    enum: ['pending', 'approved', 'denied', 'expired', 'consumed'],
  }).notNull(),
  pollIntervalSeconds: integer('poll_interval_seconds').notNull(),

  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  lastPolledAt: integer('last_polled_at', { mode: 'timestamp' }),
  decidedAt: integer('decided_at', { mode: 'timestamp' }),
});

export type BackchannelRequest = typeof backchannelRequests.$inferSelect;

/**
 * What happened, and who did it.
 *
 * Both identities on every row. That is the entire reason this table exists:
 * under impersonation the log says "the customer did it" for everything, and a
 * support team has no way to explain what happened or prevent the next one.
 *
 * `agentDisplayName` is denormalised because the log has to stay readable
 * years later, after a platform has been renamed or its registration removed.
 * What happened is a fact about the past.
 */
export const auditEvents = sqliteTable('audit_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  customerId: integer('customer_id').notNull().references(() => customers.id),

  /** NULL when the customer did it themselves. */
  agentId: text('agent_id'),
  agentDisplayName: text('agent_display_name'),

  action: text('action', {
    enum: [
      'grant_requested', 'grant_approved', 'grant_denied',
      'order_placed', 'order_refused',
      'step_up_requested', 'step_up_approved',
      'agent_refused', 'access_revoked',
    ],
  }).notNull(),

  /** One sentence, written when it happened, meant to be read by a person. */
  summary: text('summary').notNull(),

  orderNumber: integer('order_number'),
  amountCents: integer('amount_cents'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export type AuditEvent = typeof auditEvents.$inferSelect;
