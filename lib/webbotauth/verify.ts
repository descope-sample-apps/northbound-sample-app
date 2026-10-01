import { createPublicKey, verify as verifySignatureBytes } from 'node:crypto';
import {
  buildSignatureBase, contentDigest, parseSignature, parseSignatureInput,
  REQUIRED_COMPONENTS,
} from './base';

export type VerificationResult = {
  verified: boolean;
  /** The directory the request claimed. Present even on failure, for logging. */
  directoryUrl?: string;
  keyId?: string;
  reason?: string;
};

/** How far out of step a signature's clock may be. */
const MAX_AGE_SECONDS = 300;
const MAX_SKEW_SECONDS = 30;

/**
 * Verifies a Web Bot Auth signature.
 *
 * FAILS CLOSED, EVERY TIME. Every path out of this function that is not a
 * complete, fresh, correctly-keyed signature returns `verified: false` with a
 * reason. Nothing here throws into the caller, because a verifier that throws
 * invites a `catch` that treats an exception as "probably fine".
 *
 * What a pass actually means: *the holder of the private key published at this
 * directory URL signed this exact method, URI, authority and body, recently.*
 * It does NOT mean the directory belongs to anyone trustworthy — that judgment
 * is `classifyAgent`'s, and it is deliberately a separate decision.
 */
export async function verifyAgentSignature(
  request: Request,
  options: { now?: number; fetchImpl?: typeof fetch } = {},
): Promise<VerificationResult> {
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const doFetch = options.fetchImpl ?? fetch;

  const signatureInput = request.headers.get('signature-input');
  const signatureHeader = request.headers.get('signature');
  const directoryUrl = request.headers.get('signature-agent') ?? undefined;

  if (!signatureInput || !signatureHeader) {
    return { verified: false, directoryUrl, reason: 'no signature on the request' };
  }

  let input;
  try {
    input = parseSignatureInput(signatureInput);
  } catch (error) {
    return { verified: false, directoryUrl, reason: `missing or malformed Signature-Input: ${(error as Error).message}` };
  }

  // Everything Northbound needs covered must actually be covered. A signature
  // that omits the body digest or the target URI is replayable onto a
  // different request, which is the whole attack.
  for (const required of REQUIRED_COMPONENTS) {
    if (!input.params.components.includes(required)) {
      return { verified: false, directoryUrl, reason: `signature does not cover ${required}` };
    }
  }

  if (input.params.alg && input.params.alg !== 'ed25519') {
    return { verified: false, directoryUrl, reason: `unsupported alg: ${input.params.alg}` };
  }

  const { created, expires } = input.params;
  if (typeof created !== 'number' || Number.isNaN(created)) {
    return { verified: false, directoryUrl, reason: 'signature has no created timestamp' };
  }
  if (created > now + MAX_SKEW_SECONDS) {
    return { verified: false, directoryUrl, reason: 'signature created in the future' };
  }
  if (now - created > MAX_AGE_SECONDS) {
    return { verified: false, directoryUrl, reason: 'signature is too old' };
  }
  if (typeof expires === 'number' && expires < now) {
    return { verified: false, directoryUrl, reason: 'signature has expired' };
  }

  // The digest binds the body. Checking it before the signature means a changed
  // body is reported as a digest mismatch rather than an opaque crypto failure.
  const body = await request.clone().text();
  const presentedDigest = request.headers.get('content-digest');
  if (!presentedDigest) {
    return { verified: false, directoryUrl, reason: 'no content-digest header' };
  }
  if (presentedDigest.trim() !== contentDigest(body)) {
    return { verified: false, directoryUrl, reason: 'content-digest does not match the body' };
  }

  if (!directoryUrl) {
    return { verified: false, reason: 'no signature-agent key directory' };
  }

  let directory: URL;
  try {
    directory = new URL(directoryUrl);
  } catch {
    return { verified: false, directoryUrl, reason: 'signature-agent is not a URL' };
  }
  // A key fetched over http can be swapped in transit, which would make every
  // signature below meaningless. Loopback is the one exception, and only so the
  // demo can run three trust tiers on one machine with no tunnel — the same
  // carve-out, for the same reason, as loopback redirect URIs.
  const isLoopback = directory.hostname === 'localhost' || directory.hostname === '127.0.0.1';
  if (directory.protocol !== 'https:' && !(directory.protocol === 'http:' && isLoopback)) {
    return { verified: false, directoryUrl, reason: 'key directory must be https (or http on loopback)' };
  }

  const keyId = input.params.keyid;
  if (!keyId) return { verified: false, directoryUrl, reason: 'signature has no keyid' };

  let jwks: { keys?: Array<Record<string, string>> };
  try {
    const response = await doFetch(directoryUrl, { headers: { accept: 'application/json' } });
    if (!response.ok) {
      return { verified: false, directoryUrl, keyId, reason: `key directory returned ${response.status}` };
    }
    jwks = await response.json();
  } catch (error) {
    return { verified: false, directoryUrl, keyId, reason: `key directory unreachable: ${(error as Error).message}` };
  }

  const jwk = jwks.keys?.find((candidate) => candidate.kid === keyId);
  if (!jwk) {
    return { verified: false, directoryUrl, keyId, reason: 'keyid not present in the key directory' };
  }

  let publicKey;
  try {
    publicKey = createPublicKey({ key: jwk as never, format: 'jwk' });
  } catch {
    return { verified: false, directoryUrl, keyId, reason: 'key directory holds an unusable key' };
  }

  let base: string;
  let signatureBytes: Buffer;
  try {
    base = buildSignatureBase(
      { method: request.method, url: request.url, headers: request.headers },
      input,
    );
    signatureBytes = parseSignature(signatureHeader, input.label);
  } catch (error) {
    return { verified: false, directoryUrl, keyId, reason: (error as Error).message };
  }

  const ok = verifySignatureBytes(null, Buffer.from(base, 'utf8'), publicKey, signatureBytes);

  return ok
    ? { verified: true, directoryUrl, keyId }
    : { verified: false, directoryUrl, keyId, reason: 'signature does not verify against the published key' };
}
