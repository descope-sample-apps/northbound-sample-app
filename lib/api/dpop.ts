import { calculateJwkThumbprint, decodeProtectedHeader, importJWK, jwtVerify, type JWK } from 'jose';
import { headerSafe } from './refusal';

/**
 * Proof of possession for agent tokens: RFC 9449, DPoP.
 *
 * WHY THIS FILE EXISTS. Northbound used to read `Authorization: Bearer …` and nothing
 * else. Descope advertises `dpop_signing_alg_values_supported` on the Inbound App, so a
 * Poppy agent that follows spec 4.5 binds its token to a key it holds, and RFC 9449
 * section 7.1 then requires it to send that token as `Authorization: DPoP …` with a proof
 * in the `DPoP` header. The store saw a scheme it did not recognise, concluded no token
 * had been sent at all, and answered "This endpoint needs an access token the customer
 * approved for their assistant" — to an agent holding exactly that. From the agent's side
 * it looked like a session that would not stick: sign in, 401, refresh, 401.
 *
 * ACCEPTING THE SCHEME IS NOT THE SAME AS ACCEPTING THE TOKEN. A bound token carries
 * `cnf.jkt`, the thumbprint of the key it belongs to. Taking such a token on the strength
 * of the header alone would make it a bearer token again — anyone who captured it could
 * spend it — which is the one thing the binding exists to prevent. So the proof is
 * checked: it must be signed by the key the token names, for this method and this URL,
 * recently, and over this very token.
 *
 * NO IMPORTS BEYOND jose. Both the agent API and the Poppy browser-session endpoint
 * present tokens, and the browser-session endpoint must stay reachable without dragging a
 * database behind it.
 */

/**
 * The signing algorithms a proof may use. Asymmetric only: a DPoP proof's public key
 * travels in its own header, so an HMAC here would be a signature anyone could forge, and
 * `none` is not a signature at all.
 */
export const DPOP_ALGS = [
  'ES256', 'ES384', 'ES512',
  'PS256', 'PS384', 'PS512',
  'RS256', 'RS384', 'RS512',
  'EdDSA',
] as const;

/**
 * How far from now a proof's `iat` may sit, in seconds, in either direction.
 *
 * RFC 9449 section 11.1 leaves the window to the server and asks for it to be short. Five
 * minutes is the usual compromise: long enough to survive a client whose clock is off by
 * a little, short enough that a captured proof is worth little. Both directions, because
 * a proof from the future is as wrong as one from the past and a one-sided check is a
 * one-sided window.
 */
const PROOF_WINDOW_SECONDS = 300;

/** How a token arrived: which scheme named it, and the token itself. */
export type Presented = { scheme: 'bearer' | 'dpop'; token: string };

export type ProofResult = { ok: true; reason?: undefined } | { ok: false; reason: string };

function no(reason: string): ProofResult {
  return { ok: false, reason };
}

/**
 * The token from `Authorization`, and which scheme presented it, or null.
 *
 * Both schemes, because which one is right is the authorization server's decision, not
 * this store's: Descope binds the token when the agent asks it to, and the agent then has
 * no choice about the scheme. Scheme names are case-insensitive (RFC 9110 section 11.1),
 * and `DPoP` in particular is mixed-case in the RFC, so nobody should have to match its
 * capitalisation to be let in.
 */
export function presentedToken(request: Request): Presented | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const match = /^(Bearer|DPoP)[ ]+(.+)$/i.exec(header.trim());
  if (!match) return null;
  return { scheme: match[1].toLowerCase() === 'dpop' ? 'dpop' : 'bearer', token: match[2].trim() };
}

/** Private key material, which has no business in a header that travels to a server. */
function carriesPrivateKey(jwk: Record<string, unknown>): boolean {
  if (jwk.kty === 'oct') return true;
  return ['d', 'k', 'p', 'q', 'dp', 'dq', 'qi'].some((member) => member in jwk);
}

/** base64url(SHA-256(value)), which is how `ath` and a JWK thumbprint are both written. */
async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Buffer.from(digest).toString('base64url');
}

/**
 * Whether the token was presented by whoever it was issued to.
 *
 * `jkt` is the `cnf.jkt` off the VERIFIED token — never a claim peeked at before
 * verification — because this is the comparison the whole binding rests on.
 *
 * Three cases, and the middle one is the refusal that matters: an unbound token sent as
 * Bearer is the old behaviour and passes untouched; a bound token sent as Bearer is
 * refused, since accepting it would unbind it (RFC 9449 section 7.1); and a bound token
 * sent as DPoP is checked below.
 *
 * An unbound token sent as DPoP is refused too. It is a client mistake rather than an
 * attack — there is nothing to prove possession of — but answering "fine" to a request
 * that claims a protection this token does not have would leave the client believing it
 * has one.
 */
export async function checkTokenBinding(options: {
  request: Request;
  presented: Presented;
  /** The verified token's `cnf.jkt`, or undefined when the token is not bound. */
  jkt: string | undefined;
  /** The public URL the agent called: origin and path, no query (RFC 9449 section 4.2). */
  url: string;
}): Promise<ProofResult> {
  const { request, presented, jkt, url } = options;
  if (jkt === undefined) {
    if (presented.scheme === 'dpop') {
      return no('the token was sent as DPoP but is not bound to a key, so there is nothing to prove');
    }
    return { ok: true };
  }
  if (presented.scheme !== 'dpop') {
    return no('the token is bound to a key and must be sent as `Authorization: DPoP`, not Bearer');
  }
  return verifyDpopProof({
    proof: request.headers.get('dpop'),
    method: request.method,
    url,
    accessToken: presented.token,
    thumbprint: jkt,
  });
}

/**
 * One DPoP proof, checked in full (RFC 9449 section 4.3).
 *
 * The order is deliberate: everything cheap and local first, the signature next, and the
 * claims last, so a proof that was never going to verify is not also hashed and compared
 * against the token.
 *
 * NOT CHECKED: `jti` replay. RFC 9449 section 11.1 says a server SHOULD remember the
 * `jti`s it has seen. Northbound runs on serverless functions with no shared store, so a
 * cache here would live in one instance's memory and miss the replay that landed on
 * another — a defence in the comments and not in the deployment, which is worse than
 * naming the gap. What does constrain a replay is everything above: the proof is good for
 * one method, one URL, one access token and five minutes.
 */
export async function verifyDpopProof(options: {
  proof: string | null | undefined;
  method: string;
  url: string;
  accessToken: string;
  thumbprint: string;
}): Promise<ProofResult> {
  const { proof, method, url, accessToken, thumbprint } = options;
  if (!proof) return no('no DPoP proof was sent with the token');
  // Headers.get joins repeated fields with ", ", and a JWT contains no comma, so this is
  // how more than one DPoP header arrives. RFC 9449 section 4.3 allows exactly one.
  if (proof.includes(',')) return no('more than one DPoP proof was sent');

  let header: ReturnType<typeof decodeProtectedHeader>;
  try {
    header = decodeProtectedHeader(proof);
  } catch {
    return no('the DPoP proof is not a JWT');
  }
  if (header.typ !== 'dpop+jwt') return no('the DPoP proof is not typed dpop+jwt');
  const alg = header.alg;
  if (typeof alg !== 'string' || !(DPOP_ALGS as readonly string[]).includes(alg)) {
    return no(`the DPoP proof is signed with ${String(alg)}, which this store does not accept`);
  }
  const jwk = header.jwk as Record<string, unknown> | undefined;
  if (!jwk || typeof jwk !== 'object') return no('the DPoP proof carries no public key');
  if (carriesPrivateKey(jwk)) return no('the DPoP proof\'s key carries private material');

  let key: Awaited<ReturnType<typeof importJWK>>;
  try {
    key = await importJWK(jwk as JWK, alg);
  } catch {
    return no('the DPoP proof\'s key is not a usable public key');
  }
  let payload: Record<string, unknown>;
  try {
    // `algorithms` pins the verification to the algorithm named in the header AFTER that
    // name has been checked against the list above, so a proof cannot choose its own
    // weaker algorithm. jose checks `typ` again here; it is checked above as well so the
    // refusal says which part was wrong.
    ({ payload } = await jwtVerify(proof, key, { algorithms: [alg], typ: 'dpop+jwt' }) as {
      payload: Record<string, unknown>;
    });
  } catch {
    return no('the DPoP proof\'s signature does not match the key it carries');
  }

  if (typeof payload.jti !== 'string' || !payload.jti) return no('the DPoP proof carries no jti');
  if (payload.htm !== method.toUpperCase()) {
    return no(`the DPoP proof is for ${String(payload.htm)}, not ${method.toUpperCase()}`);
  }
  if (payload.htu !== url) return no(`the DPoP proof is for ${String(payload.htu)}, not ${url}`);
  const iat = payload.iat;
  if (typeof iat !== 'number' || Math.abs(Math.floor(Date.now() / 1000) - iat) > PROOF_WINDOW_SECONDS) {
    return no('the DPoP proof was not made just now; check the clock on the machine running the agent');
  }
  if (payload.ath !== (await sha256Base64Url(accessToken))) {
    return no('the DPoP proof was not made for the access token it was sent with');
  }
  if ((await calculateJwkThumbprint(jwk as JWK, 'sha256')) !== thumbprint) {
    return no('the DPoP proof is signed by a different key than the token is bound to');
  }
  return { ok: true };
}

/**
 * What an agent is told when its proof is refused.
 *
 * SAID OUT LOUD, UNLIKE A REFUSED TOKEN. lib/api/refusal.ts keeps the reason a token was
 * rejected behind a flag because it names the customer's email or which claim disagreed —
 * things only the store should know. A proof failure names nothing but the proof the
 * caller just sent: its own method, its own URL, its own key. Telling the agent is the
 * point of `invalid_dpop_proof` (RFC 9449 section 7.1), and the alternative is the silent
 * 401 loop this file was written to end.
 *
 * Flattened, because it goes into a WWW-Authenticate header where a newline is injection.
 */
export function proofRefusal(reason: string): string {
  return headerSafe(`The DPoP proof was not accepted: ${reason}.`);
}
