import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GET } from '@/app/.well-known/poppy.json/route';

const ISSUER = 'https://api.descope.test/v1/apps/P1';

let original: string | undefined;

beforeEach(() => {
  original = process.env.POPPY_ISSUER;
  delete process.env.POPPY_ISSUER;
});
afterEach(() => {
  if (original === undefined) delete process.env.POPPY_ISSUER;
  else process.env.POPPY_ISSUER = original;
});

const ORIGIN = 'https://northbound.camp';

async function document() {
  // The request matters now: `apis` carries absolute URLs built from the host the
  // document was asked on, so there is no copy of it to serve without one.
  const res = await GET(new Request(`${ORIGIN}/.well-known/poppy.json`));
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('application/json');
  return res.json();
}

describe('GET /.well-known/poppy.json', () => {
  // The version an agent checks first. Pre-1.0, compatibility needs an exact
  // major.minor match (§3.4), so a document on an older draft isn't read and ignored,
  // it's refused outright. That makes this assertion the whole file.
  it('serves a draft 0.4 document', async () => {
    expect(await document()).toEqual({
      protocol_version: '0.4',
      organization: { name: 'Northbound', domain: 'northbound.camp' },
      auth: {
        scopes: {
          'orders:read': 'See your orders and what you have in your cart',
          'orders:write': 'Place an order with your saved address and card',
          'poppy:browser-sign-in':
            'Browse the store signed in to your account, doing only what the permissions above allow',
        },
        scope_hints: {
          'orders:read': { changes: 'none', personal_data: true },
          'orders:write': { changes: 'irreversible', personal_data: true },
          'poppy:browser-sign-in': { changes: 'none', personal_data: true },
        },
      },
      web: { browser_session_endpoint: `${ORIGIN}/poppy/browser-session` },
      apis: [
        {
          type: 'openapi',
          url: `${ORIGIN}/api/agent/v1/openapi.json`,
          description: 'Browse the catalog, build the cart, and place and track orders',
        },
      ],
    });
  });

  // A Session is only worth opening if there is somewhere to spend it. Before this entry
  // existed the document described the store, its scopes and its issuer, and then offered
  // an agent no URL it was allowed to call — which is the state that made an agent asked
  // to check on an order refuse rather than answer.
  it('advertises an API an agent is allowed to call', async () => {
    const [api] = (await document()).apis;

    expect(api.type).toBe('openapi');
    // Absolute and on the host that served the document: agents reject a relative URL
    // rather than resolving it, and refuse one pointing at another site.
    expect(new URL(api.url).origin).toBe(ORIGIN);
  });

  // The API is advertised on organization.domain whichever spelling was asked for.
  // Vercel reports x-forwarded-host: www.northbound.camp even for requests to the apex,
  // and a document that says `domain: northbound.camp` and then offers an API on
  // www.northbound.camp contradicts itself: an agent sent to either one is looking for
  // the apex, and refuses an API somewhere else.
  // EVERY CASE SENDS x-forwarded-host, because that header IS the regression: Vercel
  // reported www for apex requests, and a test that leaves it out passes whether or not
  // the route reads it at all. The spellings below are the ones a proxy actually produces
  // — the alias, a differently cased host, and the explicit default port.
  it.each([
    ['the apex, reported as www', 'northbound.camp', 'www.northbound.camp'],
    ['www, reported as www', 'www.northbound.camp', 'www.northbound.camp'],
    ['the apex, reported as itself', 'northbound.camp', 'northbound.camp'],
    ['a mixed-case forwarded host', 'northbound.camp', 'WWW.Northbound.camp'],
    ['an explicit default port', 'northbound.camp', 'northbound.camp:443'],
  ])('advertises the API on the domain it names: %s', async (_name, asked, forwarded) => {
    const res = await GET(new Request(`https://${asked}/.well-known/poppy.json`, {
      headers: { 'x-forwarded-host': forwarded, 'x-forwarded-proto': 'https' },
    }));
    const doc = await res.json();

    expect(doc.organization.domain).toBe('northbound.camp');
    expect(doc.apis[0].url).toBe('https://northbound.camp/api/agent/v1/openapi.json');
  });

  // The invariant behind all of the above, and the one an agent actually checks: whatever
  // host the document ends up describing, it advertises its API on that same host.
  it('never names one host and advertises an API on another', async () => {
    for (const forwarded of ['www.northbound.camp', 'northbound.camp', 'preview-x1.vercel.app']) {
      const res = await GET(new Request('https://northbound.camp/.well-known/poppy.json', {
        headers: { 'x-forwarded-host': forwarded, 'x-forwarded-proto': 'https' },
      }));
      const doc = await res.json();

      expect(new URL(doc.apis[0].url).host).toBe(doc.organization.domain);
    }
  });

  // A forwarded host that is not a host at all must not throw its way out of a discovery
  // document and into a 500. The request's own origin is the fallback.
  it('falls back to the request when the forwarded host is junk', async () => {
    const res = await GET(new Request('https://northbound.camp/.well-known/poppy.json', {
      headers: { 'x-forwarded-host': 'not a host' },
    }));

    expect(res.status).toBe(200);
    expect((await res.json()).organization.domain).toBe('northbound.camp');
  });

  it('describes itself on a host that is not this site at all', async () => {
    const res = await GET(new Request('http://localhost:3000/.well-known/poppy.json'));
    const doc = await res.json();

    // A preview deployment and a local dev server have to be able to describe
    // themselves, so only this site's own spellings are canonicalized — and the
    // document names the host it is actually on rather than claiming to be
    // northbound.camp's document served somewhere it is not.
    expect(doc.apis[0].url).toBe('http://localhost:3000/api/agent/v1/openapi.json');
    expect(doc.organization.domain).toBe('localhost:3000');
  });

  // The issuer lives in /.well-known/oauth-protected-resource. Unconfigured, the
  // document is still complete, which is why this no longer 404s the way 0.1's did.
  it('leaves the issuer out when POPPY_ISSUER is unset', async () => {
    const doc = await document();

    expect(doc.auth).not.toHaveProperty('issuer');
  });

  it('names the issuer when POPPY_ISSUER is set', async () => {
    process.env.POPPY_ISSUER = ISSUER;

    expect((await document()).auth.issuer).toBe(ISSUER);
  });

  // "At least one of agent, apis, or web" — a document that advertises no channel at
  // all tells an agent nothing it can act on.
  it('advertises a channel', async () => {
    const doc = await document();

    expect(Object.keys(doc).some((key) => ['agent', 'apis', 'web'].includes(key))).toBe(true);
  });

  it('hints at every scope it describes', async () => {
    const { auth } = await document();

    expect(Object.keys(auth.scope_hints)).toEqual(Object.keys(auth.scopes));
    for (const hint of Object.values(auth.scope_hints) as { changes: string }[]) {
      expect(['none', 'reversible', 'irreversible']).toContain(hint.changes);
    }
  });

  // The document is a promise about what a token can do here. These are the scopes the
  // store actually enforces, and advertising one it ignores would be a lie an agent only
  // discovers after the customer has approved it.
  //
  // TWO FILES, BECAUSE TWO THINGS ENFORCE. The orders scopes are what the token resolver
  // demands of every token; poppy:browser-sign-in is demanded by the browser-session
  // endpoint instead (section 6), and a token carrying only it still is not signed in
  // here. Reading just the resolver would have called the browser scope undefined.
  it('describes only scopes the store enforces', async () => {
    const enforcers = [
      join('lib', 'agentSession', 'descope.ts'),
      join('lib', 'agentSession', 'browserJoin.ts'),
    ].map((path) => readFileSync(join(process.cwd(), path), 'utf8')).join('\n');
    const { auth } = await document();

    for (const scope of Object.keys(auth.scopes)) {
      expect(enforcers).toContain(`'${scope}'`);
    }
  });

  // ADVERTISING THE ENDPOINT IS A PROMISE, not a hint. Section 6: when a Company lists
  // it, "the Personal Agent MUST join its browser to a Session before browsing the
  // Company's website". A URL here that does not answer breaks browsing that worked.
  it('advertises the browser-session endpoint the store actually serves', async () => {
    const doc = await document();

    expect(doc.web.browser_session_endpoint).toBe(`${ORIGIN}/poppy/browser-session`);
    expect(existsSync(join(process.cwd(), 'app', 'poppy', 'browser-session', 'route.ts'))).toBe(true);
    expect(existsSync(join(process.cwd(), 'app', 'poppy', 'browser-session', 'authorize', 'route.ts'))).toBe(true);
  });

  // The join only works where the cookie step 3 sets reaches the pages being browsed,
  // so the endpoint has to be on the host the document names — the same invariant the
  // API URL is held to above.
  it('puts the browser-session endpoint on the domain it names', async () => {
    for (const forwarded of ['www.northbound.camp', 'northbound.camp', 'preview-x1.vercel.app']) {
      const res = await GET(new Request('https://northbound.camp/.well-known/poppy.json', {
        headers: { 'x-forwarded-host': forwarded, 'x-forwarded-proto': 'https' },
      }));
      const doc = await res.json();

      expect(new URL(doc.web.browser_session_endpoint).host).toBe(doc.organization.domain);
    }
  });

  // Northbound's website applies the cookie's scopes — checkout still asks for
  // orders:write, and account changes are still refused. Section 6 reserves
  // `web.unscoped` for a site where the scope means the account's full access instead,
  // and setting it here would ask customers to approve far more than it grants.
  it('does not claim browsing is unscoped', async () => {
    expect((await document()).web).not.toHaveProperty('unscoped');
  });
});
