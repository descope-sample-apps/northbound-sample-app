import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';

export const customers = sqliteTable('customers', {
  id: integer('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),

  // Nullable on purpose. A customer whose credential lives in the legacy
  // backend has no local hash at all — not an empty string, not a placeholder.
  passwordHash: text('password_hash'),

  // Login dispatch discriminator. 'local' verifies against password_hash;
  // 'legacy' delegates over HTTP to /legacy-auth/verify. This is what lets the
  // login handler support a migrated account without special-casing its email.
  authBackend: text('auth_backend', { enum: ['local', 'legacy'] }).notNull(),

  // Provenance only — no behavioural effect in the storefront. Recorded now
  // because sub-project C resolves a Google-origin customer through a
  // non-local issuer, and adding the column later would mean a migration.
  signupOrigin: text('signup_origin', { enum: ['web', 'google'] }).notNull(),

  passwordSetAt: integer('password_set_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

// ============================================================================
// SECURITY BOUNDARY — why the session token is opaque
// ============================================================================
// `id` is 32 random bytes and IS the raw cookie value. It carries no claims,
// no signature, and no meaning outside this table.
//
// This is a structural answer to the requirement that the agent API must never
// accept a browser session. A JWT session cookie would be SHAPED like a bearer
// token, and the only thing stopping it being presented to /api/* would be a
// check some future contributor might not preserve. An opaque database token
// cannot be validated as an access token by any code path — including code
// written by someone who never read the test.
// ============================================================================
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  customerId: integer('customer_id').notNull().references(() => customers.id),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  lastSeenAt: integer('last_seen_at', { mode: 'timestamp' }).notNull(),
  revokedAt: integer('revoked_at', { mode: 'timestamp' }),
  userAgent: text('user_agent'),
});

export type Customer = typeof customers.$inferSelect;
export type Session = typeof sessions.$inferSelect;
