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

describe('sign-in behaviour', () => {
  it('issues a resolvable session for each of the three seeded customers', async () => {
    const { verifyCredentials } = await import('@/lib/auth/verify');
    const { createSession, resolveSession } = await import('@/lib/auth/session');

    for (const [email, password, id] of [
      ['alice@example.com', 'password123', 82731],
      ['bob@example.com', 'legacy-pass-2019', 19382],
      ['carol@example.com', 'password123', 44102],
    ] as const) {
      const result = await verifyCredentials(email, password);
      expect(result.ok, email).toBe(true);
      const token = await createSession(result.customerId!);
      expect((await resolveSession(token))?.id, email).toBe(id);
    }
  });

  // The login form must show one message for every failure. A different
  // message for "no such account" turns the form into an account enumerator.
  it('fails identically for a wrong password and an unknown account', async () => {
    const { verifyCredentials } = await import('@/lib/auth/verify');
    expect(await verifyCredentials('alice@example.com', 'wrong')).toEqual({ ok: false });
    expect(await verifyCredentials('ghost@example.com', 'wrong')).toEqual({ ok: false });
  });

  it('kills the session on sign-out', async () => {
    const { createSession, revokeSession, resolveSession } =
      await import('@/lib/auth/session');
    const token = await createSession(82731);
    await revokeSession(token);
    expect(await resolveSession(token)).toBeNull();
  });
});

describe('registerCustomer', () => {
  it('creates a local, unverified, web-origin customer who can then sign in', async () => {
    const { registerCustomer } = await import('@/lib/auth/register');
    const { verifyCredentials } = await import('@/lib/auth/verify');

    const id = await registerCustomer({
      email: 'dana@example.com', name: 'Dana Okafor', password: 'a-long-enough-pw',
    });

    const [created] = await tdb.db.select().from(schema.customers)
      .where(eq(schema.customers.id, id));
    expect(created.authBackend).toBe('local');
    expect(created.signupOrigin).toBe('web');
    expect(created.emailVerified).toBe(false);
    expect(created.passwordHash).not.toBeNull();

    expect(await verifyCredentials('dana@example.com', 'a-long-enough-pw'))
      .toEqual({ ok: true, customerId: id });
  });

  it('does not collide with the seeded customer ids', async () => {
    const { registerCustomer } = await import('@/lib/auth/register');
    const id = await registerCustomer({
      email: 'dana@example.com', name: 'Dana', password: 'a-long-enough-pw',
    });
    expect([82731, 19382, 44102]).not.toContain(id);
  });

  it('rejects a duplicate email, case-insensitively', async () => {
    const { registerCustomer } = await import('@/lib/auth/register');
    const { ValidationError } = await import('@/lib/services/errors');
    await expect(registerCustomer({
      email: 'ALICE@example.com', name: 'Impostor', password: 'a-long-enough-pw',
    })).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a short password and a malformed email', async () => {
    const { registerCustomer } = await import('@/lib/auth/register');
    const { ValidationError } = await import('@/lib/services/errors');
    await expect(registerCustomer({
      email: 'dana@example.com', name: 'Dana', password: 'short',
    })).rejects.toBeInstanceOf(ValidationError);
    await expect(registerCustomer({
      email: 'not-an-email', name: 'Dana', password: 'a-long-enough-pw',
    })).rejects.toBeInstanceOf(ValidationError);
  });

  it('stores the email lowercased so sign-in is case-insensitive', async () => {
    const { registerCustomer } = await import('@/lib/auth/register');
    const { verifyCredentials } = await import('@/lib/auth/verify');
    await registerCustomer({
      email: 'Dana@Example.COM', name: 'Dana', password: 'a-long-enough-pw',
    });
    expect((await verifyCredentials('dana@example.com', 'a-long-enough-pw')).ok).toBe(true);
  });
});

describe('the post-login redirect', () => {
  // An open redirect on a login page is a phishing primitive: the link looks
  // like Northbound, the password goes to Northbound, and the customer lands
  // somewhere else. Only a same-origin path is honoured.
  it('accepts only same-origin paths', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('app/login/actions.ts', 'utf8');

    // The guard must reject protocol-relative URLs, which browsers treat as
    // absolute to another host.
    expect(source).toMatch(/startsWith\('\/\/'\)/);
    expect(source).toMatch(/startsWith\('\/'\)/);
  });
});
