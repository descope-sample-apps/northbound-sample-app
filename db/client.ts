import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from './schema';

// @libsql/client rather than better-sqlite3: identical Drizzle code runs against
// a local file by default and against a hosted libsql (Turso) by changing this
// one variable. Vercel's filesystem is ephemeral, so a hosted demo that needs
// to retain carts and orders points DATABASE_URL at a remote libsql instead.
const url = process.env.DATABASE_URL ?? 'file:./data/northbound.db';

// The directory has to exist before createClient runs, and createClient runs at
// module load. ESM hoists imports, so any caller that did this itself would
// always be too late — `import { db } from './client'` has already opened the
// file by the time the caller's first statement executes.
if (url.startsWith('file:')) {
  mkdirSync(dirname(url.slice('file:'.length)), { recursive: true });
}

export const sqlite = createClient({ url });
export const db = drizzle(sqlite, { schema });

export type DB = typeof db;
