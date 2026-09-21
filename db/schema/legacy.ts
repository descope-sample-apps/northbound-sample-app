// ============================================================================
// SIMULATED LEGACY AUTH BACKEND — NOT PART OF THE NORTHBOUND APPLICATION
// ============================================================================
// This table stands in for a 2019 authentication system that Northbound does
// not own and cannot schema-migrate. It shares a SQLite file with the rest of
// the app only because this project is required to run with no external
// services; conceptually it is a different system on a different host.
//
// There is deliberately NO foreign key to `customers`. The legacy system knows
// nothing about Northbound's customer records and keys on its own identifier.
// Adding a foreign key here would quietly turn two systems into one and make
// the whole delegation demo a fiction.
//
// IMPORT RULE — enforced by a test in test/legacy-auth.test.ts:
//   The only module permitted to import this file is
//   `app/legacy-auth/verify/route.ts`.
//   Every other caller — the storefront login action, and later the
//   authorization server in sub-project C — reaches it over HTTP.
// ============================================================================
import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';

export const legacyCredentials = sqliteTable('legacy_credentials', {
  legacyUserId: integer('legacy_user_id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export type LegacyCredential = typeof legacyCredentials.$inferSelect;
