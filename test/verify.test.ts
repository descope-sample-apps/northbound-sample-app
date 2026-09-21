import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { withTestDb, seedMinimal, type TestDb } from './harness';

let tdb: TestDb;

vi.mock('@/db/client', () => ({
  get db() {
    return (globalThis as { __testDb?: unknown }).__testDb;
  },
}));

beforeEach(async () => {
  tdb = await withTestDb();
  await seedMinimal(tdb);
  (globalThis as { __testDb?: unknown }).__testDb = tdb.db;
  process.env.LEGACY_AUTH_SERVICE_TOKEN = 'test-token';
});

afterEach(async () => { await tdb.close(); });

describe('verifyCredentials', () => {
  it('authenticates Alice against the local password hash', async () => {
    const { verifyCredentials } = await import('@/lib/auth/verify');
    expect(await verifyCredentials('alice@example.com', 'password123'))
      .toEqual({ ok: true, customerId: 82731 });
  });

  it('authenticates Carol against the local password hash', async () => {
    const { verifyCredentials } = await import('@/lib/auth/verify');
    expect(await verifyCredentials('carol@example.com', 'password123'))
      .toEqual({ ok: true, customerId: 44102 });
  });

  // Bob's credential is NOT in customers.password_hash. It resolves only by
  // delegating to the simulated legacy backend.
  it('authenticates Bob by delegating to the legacy backend', async () => {
    const { verifyCredentials } = await import('@/lib/auth/verify');
    expect(await verifyCredentials('bob@example.com', 'legacy-pass-2019'))
      .toEqual({ ok: true, customerId: 19382 });
  });

  it('rejects Bob with a wrong legacy password', async () => {
    const { verifyCredentials } = await import('@/lib/auth/verify');
    expect(await verifyCredentials('bob@example.com', 'password123')).toEqual({ ok: false });
  });

  it('returns an identical failure shape for an unknown email', async () => {
    const { verifyCredentials } = await import('@/lib/auth/verify');
    expect(await verifyCredentials('nobody@example.com', 'whatever')).toEqual({ ok: false });
  });

  it('is case-insensitive and trims the email', async () => {
    const { verifyCredentials } = await import('@/lib/auth/verify');
    expect(await verifyCredentials('  ALICE@Example.com ', 'password123'))
      .toEqual({ ok: true, customerId: 82731 });
  });

  it('never writes a local hash for a legacy-backed customer', async () => {
    const { verifyCredentials } = await import('@/lib/auth/verify');
    await verifyCredentials('bob@example.com', 'legacy-pass-2019');
    const [bob] = await tdb.db.select().from(schema.customers)
      .where(eq(schema.customers.id, 19382));
    expect(bob.passwordHash).toBeNull();
  });

  it('rejects an empty password without consulting any backend', async () => {
    const { verifyCredentials } = await import('@/lib/auth/verify');
    expect(await verifyCredentials('alice@example.com', '')).toEqual({ ok: false });
  });
});
