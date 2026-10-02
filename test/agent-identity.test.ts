import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { generateKeyPairSync, createPublicKey, type KeyObject } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Resolving WHO an agent is, before any CIBA request goes out.
 *
 * Two sources with different standing: a Web Bot Auth signature proves an
 * identity, a button on /agents merely claims one. The distinction has to
 * survive all the way to the cap and to the consent screen, because the whole
 * argument for signing is that the top tier cannot be self-asserted.
 */

const MUSE_DIRECTORY = 'https://agents.muse.example/.well-known/http-message-signatures-directory';
const NOBODY_DIRECTORY = 'https://nobody-knows-me.example/.well-known/http-message-signatures-directory';

let muse: { publicKey: KeyObject; privateKey: KeyObject };
let stranger: { publicKey: KeyObject; privateKey: KeyObject };
let configDir: string;
let directories: Map<string, unknown>;

const REGISTRY = {
  platforms: [
    {
      key: 'muse',
      displayName: 'Muse',
      owner: 'Meta',
      logoPath: '/agents/muse.svg',
      directoryHosts: ['agents.muse.example'],
      trusted: true,
      descopeClientIdEnv: 'DESCOPE_CLIENT_MUSE',
    },
    {
      key: 'instinct',
      displayName: 'Instinct',
      owner: 'Instinct',
      logoPath: '/agents/instinct.svg',
      directoryHosts: ['agents.instinct.example'],
      trusted: true,
      descopeClientIdEnv: 'DESCOPE_CLIENT_INSTINCT',
    },
  ],
};

beforeEach(() => {
  vi.resetModules();
  muse = generateKeyPairSync('ed25519');
  stranger = generateKeyPairSync('ed25519');

  configDir = mkdtempSync(join(tmpdir(), 'nb-agents-'));
  const path = join(configDir, 'agent-platforms.json');
  writeFileSync(path, JSON.stringify(REGISTRY));
  process.env.NORTHBOUND_AGENT_PLATFORMS_FILE = path;

  directories = new Map();
  vi.stubGlobal('fetch', async (input: string | URL) => {
    const key = String(input);
    if (!directories.has(key)) return new Response('nope', { status: 404 });
    return new Response(JSON.stringify(directories.get(key)), { status: 200 });
  });
});

afterEach(() => {
  rmSync(configDir, { recursive: true, force: true });
  delete process.env.NORTHBOUND_AGENT_PLATFORMS_FILE;
  delete process.env.DESCOPE_CLIENT_MUSE;
  vi.unstubAllGlobals();
});

async function publish(directoryUrl: string, publicKey: KeyObject) {
  const { exportPublicJwk } = await import('@/lib/webbotauth/sign');
  directories.set(directoryUrl, { keys: [await exportPublicJwk(publicKey)] });
}

async function signedRequest(privateKey: KeyObject, directoryUrl: string) {
  const { signRequest } = await import('@/lib/webbotauth/sign');
  return signRequest(
    new Request('https://northbound.example/api/agent/authorize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ login_hint: 'alice@example.com' }),
    }),
    { privateKey, directoryUrl },
  );
}

async function identify(request: Request, declared?: string) {
  const { identifyAgent } = await import('@/lib/agents/identify');
  return identifyAgent(request, { declaredPlatform: declared });
}

describe('a signed request from a known platform', () => {
  it('is verified, named, and trusted', async () => {
    await publish(MUSE_DIRECTORY, muse.publicKey);
    const identity = await identify(await signedRequest(muse.privateKey, MUSE_DIRECTORY));

    expect(identity.verified).toBe(true);
    expect(identity.tier).toBe('verified-trusted');
    expect(identity.platformKey).toBe('muse');
    expect(identity.displayName).toBe('Muse');
  });

  it('names the Descope client configured for that platform', async () => {
    process.env.DESCOPE_CLIENT_MUSE = 'descope-client-for-muse';
    await publish(MUSE_DIRECTORY, muse.publicKey);
    const identity = await identify(await signedRequest(muse.privateKey, MUSE_DIRECTORY));

    expect(identity.descopeClientId).toBe('descope-client-for-muse');
  });

  it('reports no client when the platform has none configured yet', async () => {
    await publish(MUSE_DIRECTORY, muse.publicKey);
    const identity = await identify(await signedRequest(muse.privateKey, MUSE_DIRECTORY));

    // A missing client is a configuration gap, not a trust decision. It must
    // not silently downgrade the tier, or a misconfiguration would look
    // identical to an attack.
    expect(identity.descopeClientId).toBeNull();
    expect(identity.tier).toBe('verified-trusted');
    expect(identity.needsDescopeClient).toBe(true);
  });
});

describe('a signed request from a platform nobody has registered', () => {
  it('is verified but not trusted, and asks for a client to be created', async () => {
    await publish(NOBODY_DIRECTORY, stranger.publicKey);
    const identity = await identify(await signedRequest(stranger.privateKey, NOBODY_DIRECTORY));

    expect(identity.verified).toBe(true);
    expect(identity.tier).toBe('verified-unknown');
    expect(identity.platformKey).toBeNull();
    expect(identity.needsDescopeClient).toBe(true);
    // Named by its directory so the audit log can distinguish it from the next
    // unregistered agent.
    expect(identity.displayName).toContain('nobody-knows-me.example');
  });
});

describe('a button click on /agents', () => {
  it('names the platform but does not claim it was verified', async () => {
    const plain = new Request('https://northbound.example/api/agent/authorize', {
      method: 'POST', body: '{}',
    });
    const identity = await identify(plain, 'muse');

    expect(identity.platformKey).toBe('muse');
    expect(identity.displayName).toBe('Muse');
    expect(identity.verified).toBe(false);
    expect(identity.tier).toBe('declared');
  });

  // THE LOAD-BEARING TEST. If clicking a button could reach the trusted tier,
  // signing would buy nothing and the three-tier table would be decorative.
  it('cannot reach a purchasing tier by claiming a trusted platform', async () => {
    const plain = new Request('https://northbound.example/api/agent/authorize', {
      method: 'POST', body: '{}',
    });

    for (const claimed of ['muse', 'instinct']) {
      const identity = await identify(plain, claimed);
      expect(identity.tier, claimed).toBe('declared');
      expect(identity.verified, claimed).toBe(false);
    }
  });

  it('ignores a button naming a platform that is not registered', async () => {
    const plain = new Request('https://northbound.example/api/agent/authorize', {
      method: 'POST', body: '{}',
    });
    const identity = await identify(plain, 'not-a-real-platform');

    expect(identity.tier).toBe('unverified');
    expect(identity.platformKey).toBeNull();
  });

  // A real signature always wins over a claim, including a contradictory one.
  it('is overridden by a signature when both are present', async () => {
    await publish(NOBODY_DIRECTORY, stranger.publicKey);
    const request = await signedRequest(stranger.privateKey, NOBODY_DIRECTORY);
    const identity = await identify(request, 'muse');

    expect(identity.verified).toBe(true);
    expect(identity.tier).toBe('verified-unknown');
    expect(identity.platformKey).toBeNull();
  });

  // A forged signature must not be rescued by a button click either.
  it('does not let a declared platform launder a failed signature', async () => {
    await publish(MUSE_DIRECTORY, muse.publicKey);
    const forged = await signedRequest(stranger.privateKey, MUSE_DIRECTORY);
    const identity = await identify(forged, 'muse');

    expect(identity.verified).toBe(false);
    expect(identity.tier).not.toBe('verified-trusted');
    expect(identity.tier).not.toBe('verified-unknown');
  });
});

describe('no signature and no button', () => {
  it('is unverified and unnamed', async () => {
    const plain = new Request('https://northbound.example/api/agent/authorize', {
      method: 'POST', body: '{}',
    });
    const identity = await identify(plain);

    expect(identity.tier).toBe('unverified');
    expect(identity.verified).toBe(false);
    expect(identity.platformKey).toBeNull();
  });
});

describe('caps follow the tier, not the name', () => {
  it('gives a purchase grant only to a verified agent', async () => {
    const { capForTier } = await import('@/lib/webbotauth/tiers');

    expect(capForTier('verified-trusted')?.max_amount.value).toBe('200.00');
    expect(capForTier('verified-unknown')?.max_amount.value).toBe('50.00');
    expect(capForTier('declared')).toBeNull();
    expect(capForTier('unverified')).toBeNull();
  });

  it('gives a declared agent read-only scopes, same as an unknown one', async () => {
    const { scopesForTier } = await import('@/lib/webbotauth/tiers');

    expect(scopesForTier('declared')).toEqual(scopesForTier('unverified'));
    expect(scopesForTier('declared')).not.toContain('checkout');
  });
});

describe('what the customer is told', () => {
  it('marks a declared identity as self-declared on the consent screen', async () => {
    const { consentDescription } = await import('@/lib/agents/identify');

    expect(consentDescription({
      tier: 'declared', displayName: 'Muse', verified: false,
    } as never)).toMatch(/self-declared|did not prove/i);

    expect(consentDescription({
      tier: 'verified-trusted', displayName: 'Muse', verified: true,
    } as never)).toMatch(/verified/i);
  });
});

/**
 * CIMD binding.
 *
 * Web Bot Auth and CIMD are the same shape — the agent hosts a document at an
 * HTTPS URL that identifies it. When both are present they should agree, or
 * an agent could sign as one identity and present a client belonging to
 * another.
 *
 * Northbound does not fetch or validate the CIMD document; that is the
 * authorization server's job. What it does is compare the hosts, because
 * whether a mismatch is acceptable is Northbound's policy, not Descope's.
 */
describe('CIMD host binding', () => {
  const MUSE_CIMD = 'https://agents.muse.example/client-metadata.json';
  const ELSEWHERE_CIMD = 'https://cdn.somewhere-else.example/client-metadata.json';

  async function identifyWithClient(request: Request, clientId?: string) {
    const { identifyAgent } = await import('@/lib/agents/identify');
    return identifyAgent(request, { clientId });
  }

  it('keeps the trusted tier when the CIMD host matches the key directory', async () => {
    await publish(MUSE_DIRECTORY, muse.publicKey);
    const identity = await identifyWithClient(
      await signedRequest(muse.privateKey, MUSE_DIRECTORY), MUSE_CIMD,
    );

    expect(identity.tier).toBe('verified-trusted');
    expect(identity.cimdHostMatchesDirectory).toBe(true);
  });

  // A mismatch is not necessarily an attack — plenty of platforms host keys on
  // a CDN and metadata on their app domain — so it still verifies. It just
  // cannot reach the tier that comes with a spending cap of $200.
  it('caps a mismatched agent at verified-unknown and records why', async () => {
    await publish(MUSE_DIRECTORY, muse.publicKey);
    const identity = await identifyWithClient(
      await signedRequest(muse.privateKey, MUSE_DIRECTORY), ELSEWHERE_CIMD,
    );

    expect(identity.verified).toBe(true);
    expect(identity.tier).toBe('verified-unknown');
    expect(identity.cimdHostMatchesDirectory).toBe(false);
    expect(identity.cimdHost).toBe('cdn.somewhere-else.example');
  });

  it('tells the customer about the mismatch on the consent screen', async () => {
    const { consentDescription } = await import('@/lib/agents/identify');
    const text = consentDescription({
      tier: 'verified-unknown',
      displayName: 'Muse',
      verified: true,
      cimdHostMatchesDirectory: false,
      cimdHost: 'cdn.somewhere-else.example',
      directoryUrl: MUSE_DIRECTORY,
    } as never);

    expect(text).toMatch(/different host|does not match|elsewhere/i);
  });

  it('leaves the tier alone when no client_id is presented at all', async () => {
    await publish(MUSE_DIRECTORY, muse.publicKey);
    const identity = await identifyWithClient(
      await signedRequest(muse.privateKey, MUSE_DIRECTORY),
    );

    expect(identity.tier).toBe('verified-trusted');
    expect(identity.cimdHostMatchesDirectory).toBeUndefined();
  });

  // A pre-registered client id is an opaque string, not a URL. It carries no
  // host to compare, and must not be mistaken for a failed CIMD binding.
  it('ignores a non-URL client_id, which is a pre-registered client', async () => {
    await publish(MUSE_DIRECTORY, muse.publicKey);
    const identity = await identifyWithClient(
      await signedRequest(muse.privateKey, MUSE_DIRECTORY), 'nbc_0123456789abcdef',
    );

    expect(identity.tier).toBe('verified-trusted');
    expect(identity.cimdHostMatchesDirectory).toBeUndefined();
  });

  it('never lets a CIMD host promote an unverified agent', async () => {
    const plain = new Request('https://northbound.example/api/agent/authorize', {
      method: 'POST', body: '{}',
    });
    const identity = await identifyWithClient(plain, MUSE_CIMD);
    expect(identity.tier).toBe('unverified');
  });
});
