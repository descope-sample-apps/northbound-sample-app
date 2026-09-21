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
});

afterEach(async () => { await tdb.close(); });

describe('sessions', () => {
  it('creates a token and resolves it to the customer', async () => {
    const { createSession, resolveSession } = await import('@/lib/auth/session');
    const token = await createSession(82731);
    expect((await resolveSession(token))?.id).toBe(82731);
  });

  // SECURITY: the cookie value must not be a JWT or carry any claims. An
  // opaque token cannot be mistaken for — or validated as — an access token.
  it('issues 64 hex characters with no internal structure', async () => {
    const { createSession } = await import('@/lib/auth/session');
    const token = await createSession(82731);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(token).not.toContain('.');
  });

  it('issues a different token every time', async () => {
    const { createSession } = await import('@/lib/auth/session');
    expect(await createSession(82731)).not.toBe(await createSession(82731));
  });

  it('returns null for a token that was never issued', async () => {
    const { resolveSession } = await import('@/lib/auth/session');
    expect(await resolveSession('0'.repeat(64))).toBeNull();
  });

  // REVIEW FOCUS 4: an expired session must fail closed.
  it('returns null for an expired session', async () => {
    const { createSession, resolveSession } = await import('@/lib/auth/session');
    const token = await createSession(82731);
    await tdb.db.update(schema.sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.sessions.id, token));
    expect(await resolveSession(token)).toBeNull();
  });

  // REVIEW FOCUS 4: a revoked session must fail closed.
  it('returns null for a revoked session', async () => {
    const { createSession, resolveSession, revokeSession } =
      await import('@/lib/auth/session');
    const token = await createSession(82731);
    await revokeSession(token);
    expect(await resolveSession(token)).toBeNull();
  });

  it('revoking is idempotent and tolerates an unknown token', async () => {
    const { revokeSession } = await import('@/lib/auth/session');
    await expect(revokeSession('f'.repeat(64))).resolves.toBeUndefined();
    await expect(revokeSession('')).resolves.toBeUndefined();
  });

  it('does not throw on a malformed token', async () => {
    const { resolveSession } = await import('@/lib/auth/session');
    expect(await resolveSession('')).toBeNull();
    expect(await resolveSession('not-a-token')).toBeNull();
    expect(await resolveSession('../../etc/passwd')).toBeNull();
  });

  it('advances last_seen_at when a session resolves', async () => {
    const { createSession, resolveSession } = await import('@/lib/auth/session');
    const token = await createSession(82731);
    await tdb.db.update(schema.sessions)
      .set({ lastSeenAt: new Date(Date.now() - 60_000) })
      .where(eq(schema.sessions.id, token));
    await resolveSession(token);
    const [row] = await tdb.db.select().from(schema.sessions)
      .where(eq(schema.sessions.id, token));
    expect(row.lastSeenAt.getTime()).toBeGreaterThan(Date.now() - 5_000);
  });

  it('keeps one customer\'s revocation from affecting another\'s session', async () => {
    const { createSession, resolveSession, revokeSession } =
      await import('@/lib/auth/session');
    const alice = await createSession(82731);
    const carol = await createSession(44102);
    await revokeSession(alice);
    expect(await resolveSession(alice)).toBeNull();
    expect((await resolveSession(carol))?.id).toBe(44102);
  });
});
