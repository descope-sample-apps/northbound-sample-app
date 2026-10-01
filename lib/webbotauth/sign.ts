import { createHash, createPrivateKey, createPublicKey, sign, type KeyObject } from 'node:crypto';
import { buildSignatureBase, contentDigest, parseSignatureInput, REQUIRED_COMPONENTS } from './base';

/**
 * The agent side of Web Bot Auth.
 *
 * This lives in the repository on purpose. An agent author reading the blog
 * needs to see what signing actually involves, and the demo needs to be able
 * to produce all three trust tiers offline. It is also what `pnpm agent:sign`
 * uses.
 */

export type SignOptions = {
  privateKey: KeyObject | string;
  /** Where this agent publishes its public keys. Sent as `Signature-Agent`. */
  directoryUrl: string;
  created?: number;
  expires?: number;
  label?: string;
};

/** A JWK thumbprint (RFC 7638) over the Ed25519 public key. */
export async function keyThumbprint(publicKey: KeyObject | string): Promise<string> {
  const key = typeof publicKey === 'string' ? createPublicKey(publicKey) : publicKey;
  const jwk = key.export({ format: 'jwk' }) as { crv: string; kty: string; x: string };

  // RFC 7638: lexicographic member order, no whitespace.
  const canonical = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x });
  return createHash('sha256').update(canonical).digest('base64url');
}

export async function exportPublicJwk(publicKey: KeyObject | string) {
  const key = typeof publicKey === 'string' ? createPublicKey(publicKey) : publicKey;
  const jwk = key.export({ format: 'jwk' }) as Record<string, string>;

  return {
    kty: jwk.kty,
    crv: jwk.crv,
    x: jwk.x,
    kid: await keyThumbprint(key),
    use: 'sig',
    alg: 'EdDSA',
  };
}

/**
 * Returns a copy of `request` carrying `Content-Digest`, `Signature-Agent`,
 * `Signature-Input` and `Signature`.
 *
 * The body is read here, so the request passed in is consumed.
 */
export async function signRequest(request: Request, options: SignOptions): Promise<Request> {
  const privateKey = typeof options.privateKey === 'string'
    ? createPrivateKey(options.privateKey)
    : options.privateKey;

  const publicKey = createPublicKey(privateKey);
  const keyid = await keyThumbprint(publicKey);

  const body = await request.clone().text();
  const label = options.label ?? 'sig1';
  const created = options.created ?? Math.floor(Date.now() / 1000);
  const expires = options.expires ?? created + 300;

  const headers = new Headers(request.headers);
  headers.set('content-digest', contentDigest(body));
  headers.set('signature-agent', options.directoryUrl);

  const componentList = REQUIRED_COMPONENTS.map((c) => `"${c}"`).join(' ');
  const raw =
    `(${componentList});created=${created};expires=${expires}`
    + `;keyid="${keyid}";alg="ed25519"`;

  headers.set('signature-input', `${label}=${raw}`);

  const base = buildSignatureBase(
    { method: request.method, url: request.url, headers },
    parseSignatureInput(`${label}=${raw}`),
  );

  // Ed25519 signs the message directly; the algorithm argument is null.
  const signature = sign(null, Buffer.from(base, 'utf8'), privateKey);
  headers.set('signature', `${label}=:${signature.toString('base64')}:`);

  return new Request(request.url, {
    method: request.method,
    headers,
    body: body.length > 0 ? body : undefined,
  });
}
