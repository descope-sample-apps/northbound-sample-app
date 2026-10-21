import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GET, issuerFromDiscoveryUrl } from '@/app/.well-known/poppy.json/route';

const DISCOVERY = 'https://api.descope.test/v1/apps/P1/.well-known/openid-configuration';
const ISSUER = 'https://api.descope.test/v1/apps/P1';

let original: string | undefined;

beforeEach(() => { original = process.env.DESCOPE_DISCOVERY_URL; });
afterEach(() => {
  if (original === undefined) delete process.env.DESCOPE_DISCOVERY_URL;
  else process.env.DESCOPE_DISCOVERY_URL = original;
});

describe('issuerFromDiscoveryUrl', () => {
  it('strips the well-known suffix', () => {
    expect(issuerFromDiscoveryUrl(DISCOVERY)).toBe(ISSUER);
  });

  it('tolerates a trailing slash and surrounding whitespace', () => {
    expect(issuerFromDiscoveryUrl(`  ${DISCOVERY}/  `)).toBe(ISSUER);
  });

  it('leaves a URL without the suffix unchanged', () => {
    expect(issuerFromDiscoveryUrl(ISSUER)).toBe(ISSUER);
  });

  // The suffix is only stripped from the end, so an app id that happens to contain
  // the phrase is not mangled.
  it('only strips the suffix at the end', () => {
    const odd = 'https://api.descope.test/v1/apps/.well-known/openid-configuration/P2';
    expect(issuerFromDiscoveryUrl(odd)).toBe(odd);
  });
});

describe('GET /.well-known/poppy.json', () => {
  it('serves the document with the issuer from DESCOPE_DISCOVERY_URL', async () => {
    process.env.DESCOPE_DISCOVERY_URL = DISCOVERY;

    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');

    const body = await res.json();
    expect(body).toEqual({
      protocol_version: '0.1',
      organization: { name: 'Northbound', domain: 'northbound.camp' },
      auth: { issuer: ISSUER, device: { scopes: ['openid'] } },
      web: {},
    });
  });

  // Fails closed: the storefront runs without agent support, and a document naming
  // an unconfigured issuer would be worse than no document at all.
  it('404s when DESCOPE_DISCOVERY_URL is unset', async () => {
    delete process.env.DESCOPE_DISCOVERY_URL;

    const res = await GET();
    expect(res.status).toBe(404);
  });

  it('never advertises an issuer the store would not verify against', async () => {
    process.env.DESCOPE_DISCOVERY_URL = DISCOVERY;

    const body = await (await GET()).json();
    // lib/agentSession/descope.ts derives its expected issuer from the same variable.
    expect(DISCOVERY.startsWith(body.auth.issuer)).toBe(true);
  });
});
