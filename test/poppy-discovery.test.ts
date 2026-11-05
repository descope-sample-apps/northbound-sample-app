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

async function document() {
  const res = await GET();
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('application/json');
  return res.json();
}

describe('GET /.well-known/poppy.json', () => {
  // The version an agent checks first. A document on an older draft isn't read and
  // ignored, it's refused outright (0.3 §3.1), so this assertion is the whole file.
  it('serves a draft 0.3 document', async () => {
    expect(await document()).toEqual({
      protocol_version: '0.3',
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
    });
  });

  // 0.3 moved the issuer to /.well-known/oauth-protected-resource. Unconfigured, the
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
