import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { withTestDb, seedMinimal, type TestDb } from './harness';

/**
 * Poppy section 6, the browser join, end to end.
 *
 * Three requests from two different callers, and the whole point is that neither one
 * can do it alone. The browser gets a code and a cookie it can't read; the assistant
 * authorizes the code with a token the browser never sees; only the two together set
 * a session cookie. Section 10.6 is explicit about what that prevents — an attacker
 * who authorizes a code in their own browser and then has a victim's browser post it,
 * which would hand the victim the attacker's account.
 *
 * So the refusals below are the subject, not the happy path. Each one is a step of
 * that attack failing.
 */

const ORIGIN = 'https://northbound.camp';
const SESSION_HEADER = 'eyJ0eXAiOiJwb3BweS1zZXNzaW9uK2p3dCJ9.fake.sig';

let tdb: TestDb;
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

beforeEach(async () => {
  tdb = await withTestDb();
  await seedMinimal(tdb);
  (globalThis as { __testDb?: unknown }).__testDb = tdb.db;
  resolveAgentToken.mockReset();
  resolveAgentToken.mockResolvedValue(null);
});

afterEach(async () => {
  await tdb.close();
  vi.useRealTimers();
});

/** A token this store accepts, carrying exactly these scopes. */
function tokenWith(scopes: string[], token = 'good-token') {
  resolveAgentToken.mockImplementation(async (presented: string) => {
    if (presented !== token) return null;
    const [customer] = await tdb.db.select().from((await import('@/db/schema')).customers).limit(1);
    return { customer, agent: 'agent-under-test', email: customer.email, scopes };
  });
}

function setCookies(res: Response): Map<string, { value: string; attrs: string }> {
  const jar = new Map<string, { value: string; attrs: string }>();
  for (const header of res.headers.getSetCookie()) {
    const [pair, ...rest] = header.split(';');
    const index = pair.indexOf('=');
    jar.set(pair.slice(0, index).trim(), {
      value: pair.slice(index + 1).trim(),
      attrs: rest.join(';'),
    });
  }
  return jar;
}

/** Step 1: the browser loads the page and comes away with a code and a cookie. */
async function openPage() {
  const { GET } = await import('@/app/poppy/browser-session/route');
  const res = await GET();
  const html = await res.text();
  const code = /name="code" value="([^"]+)"/.exec(html)?.[1];
  const joinCookie = setCookies(res).get('__Host-poppy_join');

  return { res, html, code: code!, joinCookie: joinCookie?.value };
}

/** Step 2: the assistant authorizes the code out of band. */
async function authorize(
  body: unknown,
  init: { token?: string; session?: string | null } = {},
) {
  const { POST } = await import('@/app/poppy/browser-session/authorize/route');
  const headers = new Headers({ 'content-type': 'application/json' });
  const session = init.session === undefined ? SESSION_HEADER : init.session;
  if (session) headers.set('poppy-session', session);
  if (init.token) headers.set('authorization', `Bearer ${init.token}`);

  return POST(new Request(`${ORIGIN}/poppy/browser-session/authorize`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  }));
}

/** Step 3: the browser posts the form back with the cookie it was given. */
async function submit(code: string, cookies: Record<string, string | undefined>) {
  const { POST } = await import('@/app/poppy/browser-session/route');
  const cookie = Object.entries(cookies)
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');

  const headers = new Headers({ 'content-type': 'application/x-www-form-urlencoded' });
  if (cookie) headers.set('cookie', cookie);

  return POST(new Request(`${ORIGIN}/poppy/browser-session`, {
    method: 'POST',
    headers,
    body: new URLSearchParams({ code }).toString(),
  }));
}

describe('step 1: the page that hands out a code', () => {
  it('serves a form carrying a one-time code', async () => {
    const { res, html, code } = await openPage();

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(html).toContain('<form method="post" action="/poppy/browser-session">');
    expect(code).toBeTruthy();
    // Unguessable: section 6 leaves the format to the Company but not the entropy.
    expect(code.length).toBeGreaterThanOrEqual(22);
  });

  it('ties the code to this browser with a __Host- cookie nobody else can set', async () => {
    const { res } = await openPage();
    const join = setCookies(res).get('__Host-poppy_join');

    expect(join).toBeDefined();
    // The whole CSRF defence of 10.6: another host on the domain must not be able to
    // plant this cookie, and the browser must not send it with a cross-site form post.
    expect(join!.attrs).toMatch(/HttpOnly/i);
    expect(join!.attrs).toMatch(/Secure/i);
    expect(join!.attrs).toMatch(/SameSite=Strict/i);
    expect(join!.attrs).toMatch(/Path=\//i);
    expect(join!.attrs).not.toMatch(/Domain=/i);
  });

  it('expires the code in a minute, not a day', async () => {
    const { res } = await openPage();
    const maxAge = /Max-Age=(\d+)/i.exec(setCookies(res).get('__Host-poppy_join')!.attrs)?.[1];

    expect(Number(maxAge)).toBeLessThanOrEqual(120);
  });

  it('refuses to be cached, framed, or kept as a window reference', async () => {
    const { res } = await openPage();

    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(res.headers.get('cross-origin-opener-policy')).toBe('same-origin');
  });

  it('hands out a different code every time', async () => {
    const first = await openPage();
    const second = await openPage();

    expect(first.code).not.toBe(second.code);
    expect(first.joinCookie).not.toBe(second.joinCookie);
  });

  it('waits to be submitted instead of submitting itself', async () => {
    const { html } = await openPage();

    // THE ORDER OF THE THREE REQUESTS IS THE PROTOCOL. The assistant reads the code
    // from this page, authorizes it (step 2), and only then has its browser post the
    // form (step 3). A page that posts itself on load spends the code before step 2
    // can happen — every join would fail, and the code is burned by the first
    // submission whatever its result, so there would be nothing to retry.
    expect(html).not.toMatch(/\.submit\(\)/);
    expect(html).not.toMatch(/<script/i);
  });

  it('starts no session and touches no other cookie', async () => {
    const { res } = await openPage();
    const names = [...setCookies(res).keys()];

    // "Loading the page MUST NOT start, end, or change any Session, or change the
    // browser's other cookies."
    expect(names).toEqual(['__Host-poppy_join']);
  });
});

describe('step 2: authorizing the code', () => {
  it('accepts a signed-out join and answers 204', async () => {
    const { code } = await openPage();

    const res = await authorize({ code });

    expect(res.status).toBe(204);
  });

  it('refuses a code it never issued', async () => {
    const res = await authorize({ code: 'bc_never-issued-by-this-store' });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_request' });
  });

  it('refuses a body with no code in it', async () => {
    const res = await authorize({ nope: true });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_request' });
  });

  it('refuses a request with no Session header', async () => {
    const { code } = await openPage();

    // The join is a join *to a Session*. Without the header there is nothing to join to.
    const res = await authorize({ code }, { session: null });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_request' });
  });

  it('refuses to authorize the same code twice', async () => {
    const { code } = await openPage();
    expect((await authorize({ code })).status).toBe(204);

    const again = await authorize({ code });

    expect(again.status).toBe(400);
  });

  it('refuses a code that has expired', async () => {
    vi.useFakeTimers();
    const { code } = await openPage();
    vi.advanceTimersByTime(5 * 60 * 1000);

    const res = await authorize({ code });

    expect(res.status).toBe(400);
  });

  it('refuses an access token this store will not accept', async () => {
    const { code } = await openPage();

    const res = await authorize({ code }, { token: 'forged' });

    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('invalid_token');
  });

  it('refuses a token without poppy:browser-sign-in, naming the scope to ask for', async () => {
    tokenWith(['orders:read']);
    const { code } = await openPage();

    const res = await authorize({ code }, { token: 'good-token' });

    // Section 6: "The Company MUST reject an access token in step 2 that doesn't have
    // the poppy:browser-sign-in scope, with insufficient_scope as at an API."
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('insufficient_scope');
    expect(res.headers.get('www-authenticate')).toContain('poppy:browser-sign-in');
  });

  it('leaves the code usable after an insufficient_scope refusal', async () => {
    tokenWith(['orders:read']);
    const { code } = await openPage();
    await authorize({ code }, { token: 'good-token' });

    // "The Personal Agent then either authorizes the same code again without an access
    // token, or gets the scope ... and starts again at step 1."
    const signedOut = await authorize({ code });

    expect(signedOut.status).toBe(204);
  });

  it('accepts a signed-in join when the token carries the scope', async () => {
    tokenWith(['orders:read', 'poppy:browser-sign-in']);
    const { code } = await openPage();

    const res = await authorize({ code }, { token: 'good-token' });

    expect(res.status).toBe(204);
  });

  it('never puts the access token anywhere the browser can reach', async () => {
    tokenWith(['orders:read', 'poppy:browser-sign-in']);
    const { code, joinCookie } = await openPage();
    await authorize({ code }, { token: 'good-token' });

    const res = await submit(code, { '__Host-poppy_join': joinCookie });
    const cookies = setCookies(res);

    for (const { value } of cookies.values()) {
      expect(value).not.toContain('good-token');
    }
  });
});

describe('step 3: the browser submits the form', () => {
  it('sets a session cookie when the code, the cookie and the authorization all agree', async () => {
    const { code, joinCookie } = await openPage();
    await authorize({ code });

    const res = await submit(code, { '__Host-poppy_join': joinCookie });
    const cookies = setCookies(res);

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/');
    expect(cookies.get('__Host-nb_agent_browser')?.value).toBeTruthy();
    expect(cookies.get('__Host-nb_agent_browser')!.attrs).toMatch(/HttpOnly/i);
    expect(cookies.get('__Host-nb_agent_browser')!.attrs).toMatch(/Secure/i);
  });

  it('clears the join cookie once it has been spent', async () => {
    const { code, joinCookie } = await openPage();
    await authorize({ code });

    const cleared = setCookies(await submit(code, { '__Host-poppy_join': joinCookie }))
      .get('__Host-poppy_join');

    expect(cleared).toBeDefined();
    expect(cleared!.value).toBe('');
  });

  it('refuses a submission from a browser that never loaded the page', async () => {
    const { code } = await openPage();
    await authorize({ code });

    // This is the attack in 10.6: the code was authorized, but this browser has no
    // cookie tying it to the page that issued it.
    const res = await submit(code, {});

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(setCookies(res).has('__Host-nb_agent_browser')).toBe(false);
  });

  it('refuses a code paired with another browser\'s join cookie', async () => {
    const victim = await openPage();
    const attacker = await openPage();
    await authorize({ code: attacker.code });

    // The attacker authorized their own code and got the victim's browser to post it.
    // The victim's browser carries the victim's join cookie, which does not match.
    const res = await submit(attacker.code, { '__Host-poppy_join': victim.joinCookie });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(setCookies(res).has('__Host-nb_agent_browser')).toBe(false);
  });

  it('refuses a code nobody authorized', async () => {
    const { code, joinCookie } = await openPage();

    const res = await submit(code, { '__Host-poppy_join': joinCookie });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(setCookies(res).has('__Host-nb_agent_browser')).toBe(false);
  });

  it('burns the code on the first submission, whatever the result', async () => {
    const { code, joinCookie } = await openPage();
    await authorize({ code });

    // A first submission that fails for want of the cookie still spends the code:
    // "A code is used by the first request that submits it, whatever the result."
    await submit(code, {});
    const retry = await submit(code, { '__Host-poppy_join': joinCookie });

    expect(retry.status).toBeGreaterThanOrEqual(400);
    expect(setCookies(retry).has('__Host-nb_agent_browser')).toBe(false);
  });

  it('refuses a replay of a code that already worked', async () => {
    const { code, joinCookie } = await openPage();
    await authorize({ code });
    expect((await submit(code, { '__Host-poppy_join': joinCookie })).status).toBe(303);

    const replay = await submit(code, { '__Host-poppy_join': joinCookie });

    expect(replay.status).toBeGreaterThanOrEqual(400);
    expect(setCookies(replay).has('__Host-nb_agent_browser')).toBe(false);
  });

  it('refuses a code that expired between authorizing and submitting', async () => {
    vi.useFakeTimers();
    const { code, joinCookie } = await openPage();
    await authorize({ code });
    vi.advanceTimersByTime(5 * 60 * 1000);

    const res = await submit(code, { '__Host-poppy_join': joinCookie });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(setCookies(res).has('__Host-nb_agent_browser')).toBe(false);
  });
});

describe('what the join does to a login the browser already had', () => {
  it('replaces it when the join carried an access token', async () => {
    tokenWith(['orders:read', 'poppy:browser-sign-in']);
    const { code, joinCookie } = await openPage();
    await authorize({ code }, { token: 'good-token' });

    const res = await submit(code, {
      '__Host-poppy_join': joinCookie,
      nb_session: 'a'.repeat(64),
    });
    const cleared = setCookies(res).get('nb_session');

    // "A join with an access token signs the browser in to the account from step 2 ...
    // in place of any login it had."
    expect(cleared).toBeDefined();
    expect(cleared!.value).toBe('');
  });

  it('leaves it alone when the join carried no access token', async () => {
    const { code, joinCookie } = await openPage();
    await authorize({ code });

    const res = await submit(code, {
      '__Host-poppy_join': joinCookie,
      nb_session: 'a'.repeat(64),
    });

    // "In a join without an access token, the Company SHOULD NOT end or change that
    // login, because the Personal Agent's browser may have a login it can't easily
    // recreate."
    expect(setCookies(res).has('nb_session')).toBe(false);
  });
});

describe('the cookie the join sets', () => {
  it('resolves to the account and scopes authorized in step 2', async () => {
    const { resolveBrowserJoin } = await import('@/lib/agentSession/browserJoin');
    tokenWith(['orders:read', 'poppy:browser-sign-in']);
    const { code, joinCookie } = await openPage();
    await authorize({ code }, { token: 'good-token' });
    const cookie = setCookies(await submit(code, { '__Host-poppy_join': joinCookie }))
      .get('__Host-nb_agent_browser')!.value;

    const session = await resolveBrowserJoin(cookie);

    expect(session?.scopes).toEqual(['orders:read', 'poppy:browser-sign-in']);
    expect(session?.customer.email).toBeTruthy();
  });

  it('re-checks the token on every request, so a disconnected assistant stops acting', async () => {
    const { resolveBrowserJoin } = await import('@/lib/agentSession/browserJoin');
    tokenWith(['orders:read', 'poppy:browser-sign-in']);
    const { code, joinCookie } = await openPage();
    await authorize({ code }, { token: 'good-token' });
    const cookie = setCookies(await submit(code, { '__Host-poppy_join': joinCookie }))
      .get('__Host-nb_agent_browser')!.value;
    expect(await resolveBrowserJoin(cookie)).not.toBeNull();

    // The customer disconnects the assistant at Descope. The cookie is untouched, but
    // it MUST stop acting for the account (section 6, "The cookie").
    resolveAgentToken.mockResolvedValue(null);

    expect(await resolveBrowserJoin(cookie)).toBeNull();
  });

  it('signs nobody in after a signed-out join', async () => {
    const { resolveBrowserJoin } = await import('@/lib/agentSession/browserJoin');
    const { code, joinCookie } = await openPage();
    await authorize({ code });
    const cookie = setCookies(await submit(code, { '__Host-poppy_join': joinCookie }))
      .get('__Host-nb_agent_browser')!.value;

    // "Not logged in. Requests belong to the Session."
    expect(await resolveBrowserJoin(cookie)).toBeNull();
  });

  it('means nothing once it has been ended', async () => {
    const { resolveBrowserJoin, endBrowserJoin } = await import('@/lib/agentSession/browserJoin');
    tokenWith(['orders:read', 'poppy:browser-sign-in']);
    const { code, joinCookie } = await openPage();
    await authorize({ code }, { token: 'good-token' });
    const cookie = setCookies(await submit(code, { '__Host-poppy_join': joinCookie }))
      .get('__Host-nb_agent_browser')!.value;

    await endBrowserJoin(cookie);

    expect(await resolveBrowserJoin(cookie)).toBeNull();
  });

  it('means nothing when it was never issued', async () => {
    const { resolveBrowserJoin } = await import('@/lib/agentSession/browserJoin');

    expect(await resolveBrowserJoin('made-up-cookie-value')).toBeNull();
  });
});
