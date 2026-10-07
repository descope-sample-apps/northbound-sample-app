import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { withTestDb, seedMinimal, type TestDb } from './harness';

let tdb: TestDb;
let jar: Map<string, string>;

vi.mock('@/db/client', () => ({
  get db() {
    return (globalThis as { __testDb?: unknown }).__testDb;
  },
}));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'user-agent': 'test' }),
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => { jar.set(name, value); },
    delete: (name: string) => { jar.delete(name); },
  }),
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); } }));

const COMPLETE = 'https://api.descope.test/v1/mgmt/flow/externalauth/complete';
let calls: { url: string; init?: RequestInit }[];
const realFetch = globalThis.fetch;

beforeEach(async () => {
  tdb = await withTestDb();
  await seedMinimal(tdb);
  (globalThis as { __testDb?: unknown }).__testDb = tdb.db;
  jar = new Map();
  calls = [];
  process.env.DESCOPE_PROJECT_ID = 'P123';
  process.env.DESCOPE_MANAGEMENT_KEY = 'mgmt-key';
  process.env.DESCOPE_BASE_URL = 'https://api.descope.test';
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return Response.json({ redirectUrl: 'https://auth.descope.test/flow/continue?x=1' });
  }) as typeof fetch;
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  delete process.env.DESCOPE_PROJECT_ID;
  delete process.env.DESCOPE_MANAGEMENT_KEY;
  delete process.env.DESCOPE_BASE_URL;
  await tdb.close();
});

function loginForm(extra: Record<string, string> = {}) {
  const form = new FormData();
  form.set('email', 'alice@example.com');
  form.set('password', 'password123');
  for (const [k, v] of Object.entries(extra)) form.set(k, v);
  return form;
}

describe('External Authentication from a Descope flow', () => {
  it('signs the customer in, tells Descope who they are, and sends them back to the flow', async () => {
    const { loginAction } = await import('@/app/login/actions');
    await expect(loginAction({}, loginForm({ external_auth_req_id: 'ear_123' })))
      .rejects.toThrow('redirect:https://auth.descope.test/flow/continue?x=1');

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(COMPLETE);
    expect(new Headers(calls[0].init?.headers).get('authorization')).toBe('Bearer P123:mgmt-key');
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body).toMatchObject({ externalAuthReqId: 'ear_123', loginId: 'alice@example.com', emailVerified: true });
    expect(jar.has('nb_session')).toBe(true);
  });

  it('does nothing different without a request ID', async () => {
    const { loginAction } = await import('@/app/login/actions');
    await expect(loginAction({}, loginForm())).rejects.toThrow('redirect:/');
    expect(calls).toHaveLength(0);
  });

  it('never calls Descope for a wrong password', async () => {
    const { loginAction } = await import('@/app/login/actions');
    const result = await loginAction({}, loginForm({ password: 'wrong', external_auth_req_id: 'ear_123' }));
    expect(result.error).toMatch(/do not match/);
    expect(calls).toHaveLength(0);
  });

  it('rejects a malformed request ID and an unconfigured project', async () => {
    const { loginAction } = await import('@/app/login/actions');
    expect((await loginAction({}, loginForm({ external_auth_req_id: 'bad id <script>' }))).error).toBeTruthy();
    delete process.env.DESCOPE_MANAGEMENT_KEY;
    expect((await loginAction({}, loginForm({ external_auth_req_id: 'ear_123' }))).error).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it("refuses to redirect anywhere but the URL Descope returns over https", async () => {
    globalThis.fetch = (async () => Response.json({ redirectUrl: 'javascript:alert(1)' })) as typeof fetch;
    const { loginAction } = await import('@/app/login/actions');
    expect((await loginAction({}, loginForm({ external_auth_req_id: 'ear_123' }))).error).toBeTruthy();
  });
});
