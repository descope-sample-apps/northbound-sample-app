import { loadEnvConfig } from '@next/env';
import { migrate } from 'drizzle-orm/libsql/migrator';

// Read .env.local the way `next dev` and `next build` do. Without this the app and this
// script disagree about which database they mean: Next loads .env.local, tsx does not,
// so a DATABASE_URL set there sends the app to the hosted database while every migration
// quietly lands on the local file — and both print the same success line.
loadEnvConfig(process.cwd());

const url = process.env.DATABASE_URL ?? 'file:./data/northbound.db';
console.log(`migrating ${url.replace(/([?&](authToken|auth_token)=)[^&]*/gi, '$1***')}`);
if (!process.env.DATABASE_URL) {
  console.log('(no DATABASE_URL — this is the local development database)');
}

// Imported after the env is loaded: db/client.ts reads DATABASE_URL at module load, and
// ESM hoists static imports above the call above. The data directory is created there too.
const { db, sqlite } = await import('./client');

await migrate(db, { migrationsFolder: './drizzle' });
sqlite.close();
console.log('migrations applied');
