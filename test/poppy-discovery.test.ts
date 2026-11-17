import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
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
        },
        scope_hints: {
          'orders:read': { changes: 'none', personal_data: true },
          'orders:write': { changes: 'irreversible', personal_data: true },
        },
      },
      web: {},
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
  it('advertises the API on the domain it names, not the host the proxy reports', async () => {
    for (const host of ['northbound.camp', 'www.northbound.camp']) {
      const res = await GET(new Request(`https://${host}/.well-known/poppy.json`));
      const doc = await res.json();

      expect(doc.apis[0].url).toBe('https://northbound.camp/api/agent/v1/openapi.json');
      expect(new URL(doc.apis[0].url).host).toBe(doc.organization.domain);
    }
  });

  it('describes itself on a host that is not this site at all', async () => {
    const res = await GET(new Request('http://localhost:3000/.well-known/poppy.json'));
    const doc = await res.json();

    // A preview deployment and a local dev server have to be able to describe
    // themselves, so only this site's own spellings are canonicalized.
    expect(doc.apis[0].url).toBe('http://localhost:3000/api/agent/v1/openapi.json');
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
  // resolver actually accepts, and advertising one it rejects would be a lie an agent
  // only discovers after the customer has approved it.
  it('describes only scopes the store accepts', async () => {
    const resolver = readFileSync(join(process.cwd(), 'lib', 'agentSession', 'descope.ts'), 'utf8');
    const { auth } = await document();

    for (const scope of Object.keys(auth.scopes)) {
      expect(resolver).toContain(`'${scope}'`);
    }
  });
});
