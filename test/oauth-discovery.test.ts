import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { withTestDb, type TestDb } from './harness';

let tdb: TestDb;
let keyDir: string;

vi.mock('@/db/client', () => ({
  get db() {
    return (globalThis as { __testDb?: unknown }).__testDb;
  },
}));

beforeEach(async () => {
  vi.resetModules();
  keyDir = mkdtempSync(join(tmpdir(), 'nb-disc-'));
  process.env.NORTHBOUND_KEY_FILE = join(keyDir, 'keys.json');
  tdb = await withTestDb();
  (globalThis as { __testDb?: unknown }).__testDb = tdb.db;
  const { seedAll } = await import('@/db/seed/index');
  await seedAll(tdb.db);
});

afterEach(async () => {
  await tdb.close();
  rmSync(keyDir, { recursive: true, force: true });
  delete process.env.NORTHBOUND_KEY_FILE;
  delete process.env.NORTHBOUND_ISSUER;
});

const req = (url: string, headers: Record<string, string> = {}) =>
  new Request(url, { headers });

describe('protected resource metadata (RFC 9728)', () => {
  it('advertises the resource, its authorization server, scopes and bearer methods',
    async () => {
      const { GET } = await import('@/app/.well-known/oauth-protected-resource/route');
      const body = await (await GET(req('https://shop.example/.well-known/oauth-protected-resource'))).json();

      expect(body.resource).toBe('https://shop.example/api');
      expect(body.authorization_servers).toEqual(['https://shop.example']);
      expect(body.bearer_methods_supported).toEqual(['header']);
      expect(body.scopes_supported).toEqual([
        'products:read', 'orders:read', 'cart:read', 'cart:write',
        'checkout', 'profile:read', 'addresses:write', 'payment_methods:write',
      ]);
      expect(body.authorization_details_types_supported).toEqual(['purchase']);
    });

  // A token in a query string lands in access logs and browser history. This
  // server has no reason to accept one, so it does not advertise that it does.
  it('does not advertise query or form-encoded bearer methods', async () => {
    const { GET } = await import('@/app/.well-known/oauth-protected-resource/route');
    const body = await (await GET(req('https://shop.example/.well-known/oauth-protected-resource'))).json();
    expect(body.bearer_methods_supported).not.toContain('query');
    expect(body.bearer_methods_supported).not.toContain('body');
  });

  it('follows the host it was reached on, so ngrok needs no configuration', async () => {
    const { GET } = await import('@/app/.well-known/oauth-protected-resource/route');
    const body = await (await GET(req('https://abc123.ngrok.io/.well-known/oauth-protected-resource'))).json();
    expect(body.resource).toBe('https://abc123.ngrok.io/api');
    expect(body.authorization_servers).toEqual(['https://abc123.ngrok.io']);
  });

  it('is never cached, because its contents vary by host', async () => {
    const { GET } = await import('@/app/.well-known/oauth-protected-resource/route');
    const res = await GET(req('https://shop.example/.well-known/oauth-protected-resource'));
    expect(res.headers.get('cache-control')).toMatch(/no-store/);
  });
});

describe('authorization server metadata (RFC 8414)', () => {
  it('advertises every endpoint against the issuer it was reached on', async () => {
    const { GET } = await import('@/app/.well-known/oauth-authorization-server/route');
    const body = await (await GET(req('https://shop.example/.well-known/oauth-authorization-server'))).json();

    expect(body.issuer).toBe('https://shop.example');
    expect(body.registration_endpoint).toBe('https://shop.example/oauth/register');
    expect(body.jwks_uri).toBe('https://shop.example/.well-known/jwks.json');
    expect(body.backchannel_authentication_endpoint)
      .toBe('https://shop.example/api/agent/authorize');
    expect(body.token_endpoint).toBe('https://shop.example/api/agent/token');
  });

  /**
   * Metadata that lies is worse than metadata that is sparse.
   *
   * An earlier version advertised four /oauth/* endpoints that were never
   * built, so an agent doing exactly what discovery is for would have walked
   * into 404s. Every advertised endpoint must resolve to a route file.
   */
  it('advertises no endpoint that does not exist', async () => {
    const { GET } = await import('@/app/.well-known/oauth-authorization-server/route');
    const body = await (await GET(req('https://shop.example/.well-known/oauth-authorization-server'))).json();

    const routeFor = (url: string) =>
      join('app', new URL(url).pathname.replace(/^\//, ''), 'route.ts');

    const advertised = Object.entries(body)
      .filter(([key, value]) =>
        key.endsWith('_endpoint') && typeof value === 'string')
      .map(([, value]) => value as string);

    expect(advertised.length).toBeGreaterThan(0);
    const missing = advertised.filter((url) => !existsSync(routeFor(url)));
    expect(missing).toEqual([]);
  });

  // Advertising S256 while accepting plain would be worse than not advertising
  // PKCE at all: a client would believe it was protected when it was not.
  it('advertises only the grants that actually work at this stage', async () => {
    const { GET } = await import('@/app/.well-known/oauth-authorization-server/route');
    const body = await (await GET(req('https://shop.example/.well-known/oauth-authorization-server'))).json();

    // CIBA only, until the authorization code endpoints are built. Claiming
    // authorization_code while /oauth/authorize 404s would break exactly the
    // client that trusted the metadata most.
    expect(body.grant_types_supported).toEqual(['urn:openid:params:grant-type:ciba']);
    expect(body.backchannel_token_delivery_modes_supported).toEqual(['poll']);
    expect(body.authorization_endpoint).toBeUndefined();
  });

  it('points agents at the prose instructions and says signing is supported', async () => {
    const { GET } = await import('@/app/.well-known/oauth-authorization-server/route');
    const body = await (await GET(req('https://shop.example/.well-known/oauth-authorization-server'))).json();

    expect(body.signed_request_methods_supported).toEqual(['web-bot-auth']);
    expect(body.agent_instructions_uri).toBe('https://shop.example/auth.md');
  });

  it('advertises the purchase authorization_details type', async () => {
    const { GET } = await import('@/app/.well-known/oauth-authorization-server/route');
    const body = await (await GET(req('https://shop.example/.well-known/oauth-authorization-server'))).json();
    expect(body.authorization_details_types_supported).toEqual(['purchase']);
  });

  it('honours x-forwarded-host from a proxy', async () => {
    const { GET } = await import('@/app/.well-known/oauth-authorization-server/route');
    const body = await (await GET(req('http://127.0.0.1:3000/.well-known/oauth-authorization-server', {
      'x-forwarded-proto': 'https', 'x-forwarded-host': 'tunnel.example',
    }))).json();
    expect(body.issuer).toBe('https://tunnel.example');
  });
});

describe('jwks', () => {
  it('publishes the public key and nothing private', async () => {
    const { GET } = await import('@/app/.well-known/jwks.json/route');
    const body = await (await GET(req('https://shop.example/.well-known/jwks.json'))).json();

    expect(body.keys).toHaveLength(1);
    expect(body.keys[0].alg).toBe('RS256');
    for (const secret of ['d', 'p', 'q', 'dp', 'dq', 'qi']) {
      expect(body.keys[0], secret).not.toHaveProperty(secret);
    }
  });
});

describe('the registration endpoint', () => {
  const register = async (body: unknown) => {
    const { POST } = await import('@/app/oauth/register/route');
    return POST(new Request('https://shop.example/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }));
  };

  it('returns 201 with a client_id', async () => {
    const res = await register({
      client_name: 'Test Agent',
      redirect_uris: ['https://agent.example/cb'],
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.client_id).toMatch(/^nbc_/);
    expect(body.demo_notice).toBeTruthy();
  });

  it('returns an OAuth error object on a bad request, not a crash', async () => {
    const res = await register({ client_name: 'No Redirects', redirect_uris: [] });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_request');
    expect(body.error_description).toMatch(/redirect/i);
  });

  it('rejects a malformed body with invalid_request', async () => {
    const { POST } = await import('@/app/oauth/register/route');
    const res = await POST(new Request('https://shop.example/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_request');
  });
});
