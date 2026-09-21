import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
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

async function post(body: unknown, token?: string) {
  const { POST } = await import('@/app/legacy-auth/verify/route');
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token !== undefined) headers['X-Legacy-Service-Token'] = token;
  return POST(new Request('http://localhost/legacy-auth/verify', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }));
}

describe('POST /legacy-auth/verify', () => {
  it('verifies a correct legacy credential', async () => {
    const res = await post(
      { email: 'bob@example.com', password: 'legacy-pass-2019' }, 'test-token');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, legacy_user_id: 5501 });
  });

  it('rejects a wrong password', async () => {
    const res = await post({ email: 'bob@example.com', password: 'nope' }, 'test-token');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false });
  });

  it('returns an identical shape for an unknown email', async () => {
    const res = await post({ email: 'nobody@example.com', password: 'nope' }, 'test-token');
    expect(await res.json()).toEqual({ ok: false });
  });

  it('is case-insensitive on email', async () => {
    const res = await post(
      { email: 'BOB@Example.COM', password: 'legacy-pass-2019' }, 'test-token');
    expect(await res.json()).toEqual({ ok: true, legacy_user_id: 5501 });
  });

  // SECURITY: this route is server-to-server only. A browser must never reach it.
  it('rejects a request with no service token', async () => {
    const res = await post({ email: 'bob@example.com', password: 'legacy-pass-2019' });
    expect(res.status).toBe(401);
  });

  it('rejects a request with the wrong service token', async () => {
    const res = await post(
      { email: 'bob@example.com', password: 'legacy-pass-2019' }, 'wrong');
    expect(res.status).toBe(401);
  });

  it('rejects a malformed body with 400, not 500', async () => {
    expect((await post({ email: 'bob@example.com' }, 'test-token')).status).toBe(400);
    expect((await post('{not json', 'test-token')).status).toBe(400);
  });

  it('checks the service token before looking at the body', async () => {
    // An unauthenticated caller must not be able to probe the credential store
    // by sending garbage and reading which error comes back.
    expect((await post('{not json')).status).toBe(401);
  });
});

describe('legacy schema isolation', () => {
  function walk(dir: string, out: string[] = []): string[] {
    if (!existsSync(dir)) return out;
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.tsx?$/.test(p)) out.push(p);
    }
    return out;
  }

  it('is imported only by the legacy verify route', () => {
    const offenders = ['app', 'lib', 'components']
      .flatMap((d) => walk(d))
      .filter((f) => f !== join('app', 'legacy-auth', 'verify', 'route.ts'))
      .filter((f) => /schema\/legacy/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
