import { migrate } from 'drizzle-orm/libsql/migrator';
import { db, sqlite } from './client';

// The data directory is created by db/client.ts at module load — see the note
// there about ESM import hoisting.
await migrate(db, { migrationsFolder: './drizzle' });
sqlite.close();
console.log('migrations applied');
