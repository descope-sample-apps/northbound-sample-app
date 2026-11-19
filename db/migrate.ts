// DEFAULT IMPORT, THEN DESTRUCTURE, which is not a style choice. @next/env is CommonJS
// with no `exports` map, and `import { loadEnvConfig } from '@next/env'` fails under
// Node 24 with "does not provide an export named 'loadEnvConfig'" — the export is there
// at runtime, but Node's static analysis of the bundled file cannot see it, so the module
// never loads and `pnpm db:setup` dies before it does anything. Taking the default and
// destructuring it asks for the whole module object instead, which always works for CJS.
import nextEnv from '@next/env';
import { migrate } from 'drizzle-orm/libsql/migrator';

const { loadEnvConfig } = nextEnv;

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
