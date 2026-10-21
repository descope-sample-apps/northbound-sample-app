import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GET } from '@/app/.well-known/poppy.json/route';

const ISSUER = 'https://api.descope.test/v1/apps/P1';

let original: string | undefined;

beforeEach(() => { original = process.env.POPPY_ISSUER; });
afterEach(() => {
  if (original === undefined) delete process.env.POPPY_ISSUER;
  else process.env.POPPY_ISSUER = original;
});

describe('GET /.well-known/poppy.json', () => {
  it('serves the document with the issuer from POPPY_ISSUER', async () => {
    process.env.POPPY_ISSUER = ISSUER;

    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');

    expect(await res.json()).toEqual({
      protocol_version: '0.1',
      organization: { name: 'Northbound', domain: 'northbound.camp' },
      auth: { issuer: ISSUER, device: { scopes: ['openid'] } },
      web: {},
    });
  });

  // Fails closed: the storefront runs without agent support, and a document naming
  // an unconfigured issuer would be worse than no document at all.
  it('404s when POPPY_ISSUER is unset', async () => {
    delete process.env.POPPY_ISSUER;

    const res = await GET();
    expect(res.status).toBe(404);
  });
});
