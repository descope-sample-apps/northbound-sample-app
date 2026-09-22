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
  clientId: text('client_id').notNull().references(() => oauthClients.clientId),
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
