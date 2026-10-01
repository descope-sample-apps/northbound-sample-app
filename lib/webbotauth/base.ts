/**
 * HTTP Message Signatures — RFC 9421.
 *
 * This module builds the *signature base*: the exact byte string that gets
 * signed and verified. Signer and verifier must produce an identical string
 * from the same request or nothing works, so both sides use the code here
 * rather than each constructing it.
 *
 * Web Bot Auth layers two conventions on top of RFC 9421:
 *
 *   - Ed25519 signatures
 *   - the signing key is published as a JWK Set at a directory URL, which the
 *     request names in a `Signature-Agent` header
 *
 * Those conventions come from the Web Bot Auth drafts rather than from a
 * finished RFC, so they are called out here instead of being presented as
 * settled standard.
 */
import { createHash } from 'node:crypto';

/** Components every Northbound agent signature must cover. */
export const REQUIRED_COMPONENTS = [
  '@method',
  '@target-uri',
  '@authority',
  'content-digest',
  'signature-agent',
] as const;

export type SignatureParams = {
  components: string[];
  created?: number;
  expires?: number;
  keyid?: string;
  alg?: string;
  nonce?: string;
  tag?: string;
};

export type ParsedSignatureInput = {
  label: string;
  params: SignatureParams;
  /** The raw value, which is what `@signature-params` must serialise to. */
  raw: string;
};

/** `sha-256=:<base64>:`, per RFC 9530. */
export function contentDigest(body: string): string {
  return `sha-256=:${createHash('sha256').update(body, 'utf8').digest('base64')}:`;
}

/**
 * Parses `Signature-Input: sig1=("@method" "@target-uri");created=1;keyid="k"`.
 *
 * Deliberately strict: anything it does not understand is a parse failure
 * rather than a silently-ignored parameter. A verifier that shrugs at
 * unrecognised input is one that can be talked into covering less than it
 * thinks it is.
 */
export function parseSignatureInput(header: string): ParsedSignatureInput {
  const match = /^([A-Za-z0-9_-]+)=(\((.*?)\)(.*))$/.exec(header.trim());
  if (!match) throw new Error('malformed Signature-Input');

  const [, label, raw, componentList, paramString] = match;

  const components = (componentList.match(/"[^"]*"/g) ?? []).map((c) => c.slice(1, -1));
  if (components.length === 0) throw new Error('Signature-Input covers no components');

  const params: SignatureParams = { components };

  for (const part of paramString.split(';')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    if (eq === -1) continue;

    const name = part.slice(0, eq);
    const value = part.slice(eq + 1);
    const unquoted = value.startsWith('"') && value.endsWith('"')
      ? value.slice(1, -1)
      : value;

    switch (name) {
      case 'created': params.created = Number(unquoted); break;
      case 'expires': params.expires = Number(unquoted); break;
      case 'keyid': params.keyid = unquoted; break;
      case 'alg': params.alg = unquoted; break;
      case 'nonce': params.nonce = unquoted; break;
      case 'tag': params.tag = unquoted; break;
      default: throw new Error(`unrecognised signature parameter: ${name}`);
    }
  }

  return { label, params, raw };
}

/** Parses `Signature: sig1=:<base64>:` into raw bytes. */
export function parseSignature(header: string, label: string): Buffer {
  const match = new RegExp(`${label}=:([A-Za-z0-9+/=]+):`).exec(header.trim());
  if (!match) throw new Error('malformed Signature header');
  return Buffer.from(match[1], 'base64');
}

function derivedComponent(name: string, url: URL, method: string): string {
  switch (name) {
    case '@method': return method.toUpperCase();
    case '@target-uri': return url.toString();
    case '@authority': return url.host;
    case '@path': return url.pathname;
    case '@query': return url.search;
    case '@scheme': return url.protocol.replace(':', '');
    default: throw new Error(`unsupported derived component: ${name}`);
  }
}

/**
 * Builds the signature base.
 *
 * Each covered component is one line, `"name": value`, and the final line is
 * `"@signature-params": <raw>` with NO trailing newline. The raw parameter
 * string is reused verbatim from the header rather than re-serialised, because
 * a verifier that re-serialises can disagree with the signer about spacing and
 * reject a perfectly good signature.
 */
export function buildSignatureBase(
  parts: { method: string; url: string; headers: Headers },
  input: ParsedSignatureInput,
): string {
  const url = new URL(parts.url);
  const lines: string[] = [];

  for (const component of input.params.components) {
    const value = component.startsWith('@')
      ? derivedComponent(component, url, parts.method)
      : parts.headers.get(component);

    if (value === null || value === undefined) {
      throw new Error(`signature covers missing component: ${component}`);
    }

    lines.push(`"${component}": ${String(value).trim()}`);
  }

  lines.push(`"@signature-params": ${input.raw}`);
  return lines.join('\n');
}
