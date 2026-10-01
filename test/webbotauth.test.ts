import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { generateKeyPairSync, type KeyObject } from 'node:crypto';

/**
 * Web Bot Auth, built on HTTP Message Signatures (RFC 9421).
 *
 * The blog's three-tier policy table depends entirely on this being real: if a
 * signature can be forged, replayed, or made to resolve against a key the
 * attacker controls, then "verified, platform you trust" means nothing and the
 * $200 cap is handed to whoever asks for it.
 */

const TRUSTED_DIRECTORY = 'https://agents.trusted-platform.example/.well-known/http-message-signatures-directory';
const UNKNOWN_DIRECTORY = 'https://somebody-elses-bot.example/.well-known/http-message-signatures-directory';

type Ed25519Pair = { publicKey: KeyObject; privateKey: KeyObject };

let trusted: Ed25519Pair;
let unknown: Ed25519Pair;
let directories: Map<string, unknown>;

beforeEach(() => {
  vi.resetModules();
  trusted = generateKeyPairSync('ed25519');
  unknown = generateKeyPairSync('ed25519');

  // Stand in for the network. The real resolver fetches these documents; what
  // matters for the security properties is which URL it is willing to fetch.
  directories = new Map();
  vi.stubGlobal('fetch', async (input: string | URL) => {
    const key = String(input);
    if (!directories.has(key)) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(directories.get(key)), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
});

afterEach(() => { vi.unstubAllGlobals(); });

async function publish(directoryUrl: string, publicKey: KeyObject) {
  const { exportPublicJwk } = await import('@/lib/webbotauth/sign');
  directories.set(directoryUrl, { keys: [await exportPublicJwk(publicKey)] });
}

async function signed(options: {
  privateKey?: KeyObject;
  directoryUrl?: string;
  body?: string;
  url?: string;
  created?: number;
  expires?: number;
} = {}) {
  const { signRequest } = await import('@/lib/webbotauth/sign');
  return signRequest(
    new Request(options.url ?? 'https://northbound.example/api/agent/authorize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: options.body ?? JSON.stringify({ login_hint: 'alice@example.com' }),
    }),
    {
      privateKey: options.privateKey ?? trusted.privateKey,
      directoryUrl: options.directoryUrl ?? TRUSTED_DIRECTORY,
      created: options.created,
      expires: options.expires,
    },
  );
}

async function verify(request: Request) {
  const { verifyAgentSignature } = await import('@/lib/webbotauth/verify');
  return verifyAgentSignature(request);
}

describe('a well-formed signature from a published key', () => {
  it('verifies', async () => {
    await publish(TRUSTED_DIRECTORY, trusted.publicKey);
    const result = await verify(await signed());

    expect(result.verified).toBe(true);
    expect(result.directoryUrl).toBe(TRUSTED_DIRECTORY);
    expect(result.keyId).toBeTruthy();
  });

  it('covers the method, the target URI, the authority and the body digest', async () => {
    await publish(TRUSTED_DIRECTORY, trusted.publicKey);
    const request = await signed();
    const input = request.headers.get('signature-input')!;

    for (const component of ['"@method"', '"@target-uri"', '"@authority"', '"content-digest"']) {
      expect(input, component).toContain(component);
    }
    expect(request.headers.get('content-digest')).toMatch(/^sha-256=:/);
    expect(request.headers.get('signature-agent')).toBe(TRUSTED_DIRECTORY);
  });
});

// REVIEW FOCUS 1 — every one of these must fail, and must fail CLOSED.
describe('a signature that should not be trusted', () => {
  it('fails when the body was changed after signing', async () => {
    await publish(TRUSTED_DIRECTORY, trusted.publicKey);
    const original = await signed({ body: JSON.stringify({ login_hint: 'alice@example.com' }) });

    const tampered = new Request(original.url, {
      method: 'POST',
      headers: original.headers,
      body: JSON.stringify({ login_hint: 'bob@example.com' }),
    });

    const result = await verify(tampered);
    expect(result.verified).toBe(false);
    expect(result.reason).toMatch(/digest/i);
  });

  it('fails when a covered header was changed after signing', async () => {
    await publish(TRUSTED_DIRECTORY, trusted.publicKey);
    const original = await signed();

    const tampered = new Request('https://northbound.example/api/agent/authorize', {
      method: 'POST',
      headers: original.headers,
      body: await original.clone().text(),
    });
    tampered.headers.set('signature-agent', UNKNOWN_DIRECTORY);

    expect((await verify(tampered)).verified).toBe(false);
  });

  it('fails when the signature was made by a different key', async () => {
    await publish(TRUSTED_DIRECTORY, trusted.publicKey);
    // Signed by `unknown`, but claiming the trusted directory.
    const result = await verify(await signed({ privateKey: unknown.privateKey }));
    expect(result.verified).toBe(false);
  });

  it('fails when the key directory cannot be fetched', async () => {
    const result = await verify(await signed()); // nothing published
    expect(result.verified).toBe(false);
    expect(result.reason).toMatch(/director|key/i);
  });

  it('fails when created is in the future', async () => {
    await publish(TRUSTED_DIRECTORY, trusted.publicKey);
    const future = Math.floor(Date.now() / 1000) + 600;
    const result = await verify(await signed({ created: future, expires: future + 60 }));
    expect(result.verified).toBe(false);
    expect(result.reason).toMatch(/future|created/i);
  });

  it('fails when the signature has expired', async () => {
    await publish(TRUSTED_DIRECTORY, trusted.publicKey);
    const past = Math.floor(Date.now() / 1000) - 3600;
    const result = await verify(await signed({ created: past, expires: past + 60 }));
    expect(result.verified).toBe(false);
    expect(result.reason).toMatch(/expired|old/i);
  });

  it('fails when there is no signature at all', async () => {
    const plain = new Request('https://northbound.example/api/agent/authorize', {
      method: 'POST', body: '{}',
    });
    const result = await verify(plain);
    expect(result.verified).toBe(false);
    expect(result.reason).toMatch(/no signature|missing/i);
  });

  it('fails when the signature covers a different target URI', async () => {
    await publish(TRUSTED_DIRECTORY, trusted.publicKey);
    const original = await signed({ url: 'https://northbound.example/api/agent/authorize' });

    const replayed = new Request('https://northbound.example/api/cart', {
      method: 'POST',
      headers: original.headers,
      body: await original.clone().text(),
    });

    expect((await verify(replayed)).verified).toBe(false);
  });
});

describe('tier classification', () => {
  const trustedHosts = ['agents.trusted-platform.example'];

  it('calls a signature from an allowlisted host verified-trusted', async () => {
    await publish(TRUSTED_DIRECTORY, trusted.publicKey);
    const { classifyAgent } = await import('@/lib/webbotauth/tiers');
    expect(classifyAgent(await verify(await signed()), trustedHosts)).toBe('verified-trusted');
  });

  // The important one. A real signature from a platform nobody has heard of is
  // still a real signature — it just does not earn the trusted cap.
  it('calls a valid signature from an unknown host verified-unknown', async () => {
    await publish(UNKNOWN_DIRECTORY, unknown.publicKey);
    const { classifyAgent } = await import('@/lib/webbotauth/tiers');
    const result = await verify(await signed({
      privateKey: unknown.privateKey, directoryUrl: UNKNOWN_DIRECTORY,
    }));
    expect(result.verified).toBe(true);
    expect(classifyAgent(result, trustedHosts)).toBe('verified-unknown');
  });

  it('calls everything else unverified', async () => {
    const { classifyAgent } = await import('@/lib/webbotauth/tiers');
    const plain = new Request('https://northbound.example/api/agent/authorize', { method: 'POST', body: '{}' });
    expect(classifyAgent(await verify(plain), trustedHosts)).toBe('unverified');
  });

  // A failed verification must never be able to reach the trusted tier, even
  // when the directory it claims IS on the allowlist.
  it('never promotes a failed verification, even from a trusted host', async () => {
    await publish(TRUSTED_DIRECTORY, trusted.publicKey);
    const { classifyAgent } = await import('@/lib/webbotauth/tiers');
    const forged = await verify(await signed({ privateKey: unknown.privateKey }));
    expect(forged.verified).toBe(false);
    expect(classifyAgent(forged, trustedHosts)).toBe('unverified');
  });
});

describe('the cap table from the blog', () => {
  it('maps each tier to its purchase limit', async () => {
    const { capForTier } = await import('@/lib/webbotauth/tiers');

    expect(capForTier('verified-trusted')).toMatchObject({
      max_amount: { value: '200.00', currency: 'USD' }, period: 'P7D',
    });
    expect(capForTier('verified-unknown')).toMatchObject({
      max_amount: { value: '50.00', currency: 'USD' }, period: 'P7D',
    });
    // Read-only means no purchase grant at all, not a grant of zero.
    expect(capForTier('unverified')).toBeNull();
  });

  it('gives an unverified agent read-only scopes', async () => {
    const { scopesForTier } = await import('@/lib/webbotauth/tiers');
    const scopes = scopesForTier('unverified');

    expect(scopes).toContain('products:read');
    expect(scopes).toContain('orders:read');
    expect(scopes).not.toContain('checkout');
    expect(scopes).not.toContain('cart:write');
  });
});

describe('the key directory transport', () => {
  it('refuses a plain-http directory on a real host', async () => {
    const insecure = 'http://agents.trusted-platform.example/.well-known/http-message-signatures-directory';
    await publish(insecure, trusted.publicKey);
    const result = await verify(await signed({ directoryUrl: insecure }));

    expect(result.verified).toBe(false);
    expect(result.reason).toMatch(/https/i);
  });

  // Allowed only so the demo can run all three tiers on one machine without a
  // tunnel. Same carve-out, same reason, as loopback redirect URIs.
  it('allows http on loopback, so the demo runs offline', async () => {
    const loopback = 'http://localhost:4455/.well-known/http-message-signatures-directory';
    await publish(loopback, trusted.publicKey);
    expect((await verify(await signed({ directoryUrl: loopback }))).verified).toBe(true);
  });
});
