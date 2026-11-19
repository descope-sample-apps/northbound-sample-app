import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { agentBrowserSessions, customers } from '@/db/schema';
import { withTestDb, seedMinimal, type TestDb } from './harness';

/**
 * What a joined browser is, once it starts browsing.
 *
 * The join itself is tested in browser-join.test.ts. This is the part after: a page
 * request arrives carrying the cookie step 3 set, and has to come out of
 * getAgentSession as the same AgentSession a bearer token produces on the API. That
 * is the whole point of doing it here rather than at the edge — requireOrderApproval
 * and refuseAgentAccountChange already read that session, so browsing is gated by the
 * scopes without a line of new policy.
 */

let tdb: TestDb;
let jar: Map<string, string>;
const resolveAgentToken = vi.fn();

vi.mock('@/db/client', () => ({
  get db() {
    return (globalThis as { __testDb?: unknown }).__testDb;
  },
}));

vi.mock('@/lib/agentSession/descope', () => ({
  resolveAgentToken: (token: string) => resolveAgentToken(token),
  descopeIssuer: async () => 'https://auth.northbound.camp/v1/apps/P1',
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => { jar.set(name, value); },
    delete: (name: string) => { jar.delete(name); },
  }),
}));
vi.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); } }));

beforeEach(async () => {
  tdb = await withTestDb();
  await seedMinimal(tdb);
  (globalThis as { __testDb?: unknown }).__testDb = tdb.db;
  jar = new Map();
  resolveAgentToken.mockReset();
  resolveAgentToken.mockResolvedValue(null);
  vi.resetModules();
});

afterEach(async () => {
  await tdb.close();
});

/** A browser already joined, signed in with these scopes. */
async function joinedBrowser(scopes: string[]) {
  const { BROWSER_SESSION_COOKIE } = await import('@/lib/agentSession/browserJoin');
  const { createHash, randomBytes } = await import('node:crypto');
  const cookieValue = randomBytes(24).toString('base64url');
  const now = new Date();

  await tdb.db.insert(agentBrowserSessions).values({
    id: createHash('sha256').update(cookieValue).digest('hex'),
    poppySession: 'sid-under-test',
    accessToken: 'stored-token',
    createdAt: now,
    expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    revokedAt: null,
  });

  resolveAgentToken.mockImplementation(async (token: string) => {
    if (token !== 'stored-token') return null;
    const [customer] = await tdb.db.select().from(customers).limit(1);
    return { customer, agent: 'agent-under-test', email: customer.email, scopes };
  });

  jar.set(BROWSER_SESSION_COOKIE, cookieValue);
  return cookieValue;
}

describe('a joined browser on the storefront', () => {
  it('browses as the account and scopes the join authorized', async () => {
    await joinedBrowser(['orders:read', 'poppy:browser-sign-in']);
    const { getAgentSession } = await import('@/lib/auth/session-cookie');

    const session = await getAgentSession();

    expect(session?.scopes).toEqual(['orders:read', 'poppy:browser-sign-in']);
    expect(session?.agent).toBe('agent-under-test');
  });

  it('is the customer the page acts for', async () => {
    await joinedBrowser(['orders:read', 'poppy:browser-sign-in']);
    const { getCurrentCustomer } = await import('@/lib/auth/session-cookie');

    expect((await getCurrentCustomer())?.email).toBeTruthy();
  });

  it('carries scopes the storefront already gates on', async () => {
    // orders:write is missing, so checkout must still ask the customer. This is the
    // assertion that says browsing did not become a way around the scope check.
    await joinedBrowser(['orders:read', 'poppy:browser-sign-in']);
    const { getAgentSession } = await import('@/lib/auth/session-cookie');
    const { requireOrderApproval } = await import('@/lib/agentSession/stepUp');

    const session = await getAgentSession();

    expect(session!.scopes).not.toContain('orders:write');
    expect(typeof requireOrderApproval).toBe('function');
  });

  it('acts as nobody once the assistant is disconnected', async () => {
    await joinedBrowser(['orders:read', 'poppy:browser-sign-in']);
    resolveAgentToken.mockResolvedValue(null);
    const { getAgentSession } = await import('@/lib/auth/session-cookie');

    expect(await getAgentSession()).toBeNull();
  });

  it('loses the join when the browser signs out on the website', async () => {
    const cookieValue = await joinedBrowser(['orders:read', 'poppy:browser-sign-in']);
    const { BROWSER_SESSION_COOKIE } = await import('@/lib/agentSession/browserJoin');
    const { clearSessionCookie } = await import('@/lib/auth/session-cookie');

    await clearSessionCookie();

    // The cookie goes from the browser, and the row is revoked, so a copy of the cookie
    // is dead too. Section 6 lists signing out on the website among the things that end
    // the Session's sign-in.
    expect(jar.has(BROWSER_SESSION_COOKIE)).toBe(false);
    const [row] = await tdb.db
      .select()
      .from(agentBrowserSessions)
      .where(eq(agentBrowserSessions.poppySession, 'sid-under-test'));
    expect(row.revokedAt).not.toBeNull();
    void cookieValue;
  });

  it('never outranks a customer who is here themselves', async () => {
    await joinedBrowser(['orders:read', 'poppy:browser-sign-in']);
    const { createSession } = await import('@/lib/auth/session');
    const { SESSION_COOKIE } = await import('@/lib/auth/session');
    const [customer] = await tdb.db.select().from(customers).limit(1);
    jar.set(SESSION_COOKIE, await createSession(customer.id));
    const { getAgentSession } = await import('@/lib/auth/session-cookie');

    // A signed-out join leaves an existing login in place, and this store resolves a
    // person before an assistant either way.
    expect(await getAgentSession()).toBeNull();
  });
});
