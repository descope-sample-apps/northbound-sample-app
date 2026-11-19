import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';

/**
 * `pnpm db:migrate`, run the way a person runs it.
 *
 * This is a subprocess rather than an import because the failure it exists to catch
 * happens at module load: `import { loadEnvConfig } from '@next/env'` threw
 * `SyntaxError: The requested module '@next/env' does not provide an export named
 * 'loadEnvConfig'` under Node 24. @next/env is CommonJS with no `exports` field, and the
 * named export is there at runtime — Node's static analysis of the bundled file just
 * cannot see it. Nothing short of actually running the script notices, which is why the
 * repository shipped with `db:setup` broken for anyone cloning it.
 *
 * SAFE AGAINST THE REAL DATABASE, and deliberately so. DATABASE_URL is set in the
 * environment here, and loadEnvConfig does not overwrite a variable that is already set —
 * the first test below pins that, because it is the only thing standing between this
 * suite and the hosted database named in .env.local.
 */

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'northbound-migrate-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function runMigrate(databaseUrl: string) {
  return spawnSync('npx', ['tsx', 'db/migrate.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: 'utf8',
    timeout: 120_000,
  });
}

describe('pnpm db:migrate', () => {
  it('runs, instead of dying on an import', async () => {
    const url = `file:${join(dir, 'migrate.db')}`;

    const run = runMigrate(url);

    expect(run.stderr ?? '').not.toContain('does not provide an export named');
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('migrations applied');

    // It did the job, not just exited quietly: the schema is there, including the newest
    // migration's tables.
    const client = createClient({ url });
    const tables = await client.execute(
      "select name from sqlite_master where type='table' order by name",
    );
    const names = tables.rows.map((r) => String(r.name));
    client.close();

    expect(names).toContain('customers');
    expect(names).toContain('orders');
    expect(names).toContain('browser_join_codes');
  }, 180_000);

  it('uses the DATABASE_URL it was given, not the one in .env.local', async () => {
    const url = `file:${join(dir, 'explicit.db')}`;

    const run = runMigrate(url);

    // The guard that keeps this suite away from the hosted database, and keeps a
    // developer's `DATABASE_URL=... pnpm db:migrate` meaning what they typed.
    expect(run.stdout).toContain(join(dir, 'explicit.db'));
    expect(run.stdout).not.toContain('turso.io');
  }, 180_000);

  it('never prints an auth token', async () => {
    // A hosted libsql URL carries its credential in the query string, and this script
    // echoes the URL it is about to migrate. Connecting will fail on a made-up token;
    // what matters is what reached stdout before it did.
    const run = runMigrate('libsql://example.turso.io?authToken=SUPERSECRETVALUE');

    expect(run.stdout).not.toContain('SUPERSECRETVALUE');
    expect(run.stdout).toContain('authToken=***');
  }, 180_000);
});
