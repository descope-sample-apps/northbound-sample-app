import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dir: string;

beforeEach(() => {
  vi.resetModules();
  dir = mkdtempSync(join(tmpdir(), 'nb-keys-'));
  process.env.NORTHBOUND_KEY_FILE = join(dir, 'keys.json');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.NORTHBOUND_KEY_FILE;
  delete process.env.NORTHBOUND_ISSUER;
});

const ISSUER = 'https://shop.example';
const AUDIENCE = 'https://shop.example/api';

const claims = {
  customerId: 82731,
  agentId: 'agent_shopping_assistant',
  clientId: 'shopping-assistant',
  scope: 'products:read cart:write checkout',
  authorizationDetails: [
    {
      type: 'purchase' as const,
      max_amount: { value: '200.00', currency: 'USD' },
      merchant: 'northbound.example.com',
      period: 'P7D',
    },
  ],
};

describe('access tokens', () => {
  it('carries both identities: sub is the customer, act.sub is the agent', async () => {
    const { signAccessToken, verifyAccessTokenSignature } = await import('@/lib/oauth/jwt');
    const { token } = await signAccessToken(claims, ISSUER);
    const verified = await verifyAccessTokenSignature(token, ISSUER, AUDIENCE);

    expect(verified.sub).toBe('user_82731');
    expect(verified.act).toEqual({ sub: 'agent_shopping_assistant' });
    expect(verified.client_id).toBe('shopping-assistant');
    expect(verified.aud).toBe(AUDIENCE);
    expect(verified.scope).toBe('products:read cart:write checkout');
  });

  it('carries the blog\'s purchase authorization_details verbatim', async () => {
    const { signAccessToken, verifyAccessTokenSignature } = await import('@/lib/oauth/jwt');
    const { token } = await signAccessToken(claims, ISSUER);
    const verified = await verifyAccessTokenSignature(token, ISSUER, AUDIENCE);

    expect(verified.authorization_details).toEqual([
      {
        type: 'purchase',
        max_amount: { value: '200.00', currency: 'USD' },
        merchant: 'northbound.example.com',
        period: 'P7D',
      },
    ]);
  });

  it('expires in 15 minutes', async () => {
    const { signAccessToken, verifyAccessTokenSignature } = await import('@/lib/oauth/jwt');
    const { token } = await signAccessToken(claims, ISSUER);
    const verified = await verifyAccessTokenSignature(token, ISSUER, AUDIENCE);
    expect(verified.exp - verified.iat).toBe(900);
  });

  // REVIEW FOCUS 1: a good signature is not authorization.
  it('rejects a token minted for a different audience', async () => {
    const { signAccessToken, verifyAccessTokenSignature } = await import('@/lib/oauth/jwt');
    const { token } = await signAccessToken(claims, ISSUER);
    await expect(verifyAccessTokenSignature(token, ISSUER, 'https://elsewhere.example/api'))
      .rejects.toThrow();
  });

  it('rejects a token from a different issuer', async () => {
    const { signAccessToken, verifyAccessTokenSignature } = await import('@/lib/oauth/jwt');
    const { token } = await signAccessToken(claims, 'https://evil.example');
    await expect(verifyAccessTokenSignature(token, ISSUER, AUDIENCE)).rejects.toThrow();
  });

  it('rejects a tampered payload', async () => {
    const { signAccessToken, verifyAccessTokenSignature } = await import('@/lib/oauth/jwt');
    const { token } = await signAccessToken(claims, ISSUER);

    const [header, payload, signature] = token.split('.');
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString());
    decoded.sub = 'user_19382';
    const forged = [
      header,
      Buffer.from(JSON.stringify(decoded)).toString('base64url'),
      signature,
    ].join('.');

    await expect(verifyAccessTokenSignature(forged, ISSUER, AUDIENCE)).rejects.toThrow();
  });

  it('rejects an unsigned token claiming alg none', async () => {
    const { verifyAccessTokenSignature } = await import('@/lib/oauth/jwt');
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      iss: ISSUER, aud: AUDIENCE, sub: 'user_82731',
      exp: Math.floor(Date.now() / 1000) + 900,
    })).toString('base64url');

    await expect(verifyAccessTokenSignature(`${header}.${payload}.`, ISSUER, AUDIENCE))
      .rejects.toThrow();
  });

  it('gives every token a distinct jti', async () => {
    const { signAccessToken } = await import('@/lib/oauth/jwt');
    const first = await signAccessToken(claims, ISSUER);
    const second = await signAccessToken(claims, ISSUER);
    expect(first.jti).not.toBe(second.jti);
  });

  // A token with no `act` is one the customer obtained directly. The two must
  // be distinguishable by construction, not by convention.
  it('omits act entirely when there is no agent', async () => {
    const { signAccessToken, verifyAccessTokenSignature } = await import('@/lib/oauth/jwt');
    const { token } = await signAccessToken({ ...claims, agentId: null }, ISSUER);
    const verified = await verifyAccessTokenSignature(token, ISSUER, AUDIENCE);
    expect(verified.act).toBeUndefined();
    expect(verified.sub).toBe('user_82731');
  });

  it('reports the expiry it actually set', async () => {
    const { signAccessToken } = await import('@/lib/oauth/jwt');
    const { expiresAt } = await signAccessToken(claims, ISSUER);
    const delta = expiresAt.getTime() - Date.now();
    expect(delta).toBeGreaterThan(890_000);
    expect(delta).toBeLessThanOrEqual(900_000);
  });
});

describe('signing keys', () => {
  it('generates once and reuses thereafter', async () => {
    const { getSigningKey } = await import('@/lib/oauth/keys');
    const first = await getSigningKey();
    const second = await getSigningKey();
    expect(first.kid).toBe(second.kid);
  });

  it('publishes a public JWKS with no private material', async () => {
    const { exportJwks } = await import('@/lib/oauth/keys');
    const jwks = await exportJwks();

    expect(jwks.keys).toHaveLength(1);
    expect(jwks.keys[0].kty).toBe('RSA');
    expect(jwks.keys[0].alg).toBe('RS256');
    expect(jwks.keys[0].use).toBe('sig');
    expect(jwks.keys[0].kid).toBeTruthy();

    for (const secret of ['d', 'p', 'q', 'dp', 'dq', 'qi']) {
      expect(jwks.keys[0], `private member ${secret} must not be published`)
        .not.toHaveProperty(secret);
    }
  });
});

describe('resolveIssuer', () => {
  it('derives the issuer from the request host so ngrok works unconfigured', async () => {
    const { resolveIssuer } = await import('@/lib/oauth/issuer');
    expect(resolveIssuer(new Request('https://abc123.ngrok.io/api/orders')))
      .toBe('https://abc123.ngrok.io');
  });

  it('honours x-forwarded-proto and x-forwarded-host', async () => {
    const { resolveIssuer } = await import('@/lib/oauth/issuer');
    const request = new Request('http://internal.local/api/orders', {
      headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'shop.example' },
    });
    expect(resolveIssuer(request)).toBe('https://shop.example');
  });

  it('lets NORTHBOUND_ISSUER override everything', async () => {
    process.env.NORTHBOUND_ISSUER = 'https://pinned.example';
    const { resolveIssuer } = await import('@/lib/oauth/issuer');
    expect(resolveIssuer(new Request('https://other.example/api'))).toBe('https://pinned.example');
  });

  it('never returns a trailing slash', async () => {
    process.env.NORTHBOUND_ISSUER = 'https://pinned.example/';
    const { resolveIssuer } = await import('@/lib/oauth/issuer');
    expect(resolveIssuer(new Request('https://other.example/api'))).toBe('https://pinned.example');
  });
});
