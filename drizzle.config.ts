import type { Config } from 'drizzle-kit';

// Both schema entry points are listed: the application schema and the
// simulated legacy backend. They are separate modules by design (see
// db/schema/legacy.ts) but both need tables created in the same file, because
// this project runs with no external services.
export default {
  schema: ['./db/schema/index.ts', './db/schema/legacy.ts'],
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'file:./data/northbound.db' },
} satisfies Config;
