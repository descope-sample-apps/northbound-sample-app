import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { generateKeyPair, exportJWK, importJWK, type JWK, type KeyObject } from 'jose';

type StoredKeys = { privateJwk: JWK; publicJwk: JWK; kid: string };

export type SigningKey = {
  privateKey: CryptoKey | KeyObject;
  publicKey: CryptoKey | KeyObject;
  kid: string;
};

function keyFilePath(): string {
  return process.env.NORTHBOUND_KEY_FILE ?? 'data/keys.json';
}

/**
 * Keys are GENERATED, never committed.
 *
 * The parent specification forbids secrets in the repository, and a checked-in
 * development key is a secret in the repository — one that would still be there
 * after somebody deployed this. Generating on first run costs a few hundred
 * milliseconds once and removes the temptation entirely.
 *
 * data/ is gitignored alongside the SQLite file.
 */
async function loadOrCreate(): Promise<StoredKeys> {
  const path = keyFilePath();

  if (existsSync(path)) {
    return JSON.parse(readFileSync(path, 'utf8')) as StoredKeys;
  }

  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
  const privateJwk = await exportJWK(privateKey);
  const publicJwk = await exportJWK(publicKey);

  // A thumbprint-derived kid, so the identifier is a function of the key rather
  // than of when it happened to be created.
  const kid = createHash('sha256')
    .update(JSON.stringify({ e: publicJwk.e, kty: publicJwk.kty, n: publicJwk.n }))
    .digest('base64url')
    .slice(0, 16);

  const stored: StoredKeys = { privateJwk, publicJwk, kid };

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(stored, null, 2), { mode: 0o600 });
  console.log(`[oauth] generated a new RS256 signing key (kid ${kid}) at ${path}`);

  return stored;
}

// Cached as a promise, so concurrent first calls generate exactly one key
// instead of racing to write the file.
let cached: Promise<SigningKey> | null = null;

export function getSigningKey(): Promise<SigningKey> {
  cached ??= (async () => {
    const stored = await loadOrCreate();
    return {
      privateKey: await importJWK(stored.privateJwk, 'RS256') as CryptoKey | KeyObject,
      publicKey: await importJWK(stored.publicJwk, 'RS256') as CryptoKey | KeyObject,
      kid: stored.kid,
    };
  })();

  return cached;
}

/** Public key set, for `/.well-known/jwks.json`. */
export async function exportJwks(): Promise<{ keys: JWK[] }> {
  const stored = await loadOrCreate();

  // Rebuilt field by field rather than by deleting private members from a
  // spread: an allowlist cannot leak a member somebody adds later.
  const { kty, n, e } = stored.publicJwk;
  return { keys: [{ kty, n, e, kid: stored.kid, use: 'sig', alg: 'RS256' }] };
}

/** Test seam: forget the cached key so a fresh key file is picked up. */
export function resetKeyCacheForTests(): void {
  cached = null;
}
