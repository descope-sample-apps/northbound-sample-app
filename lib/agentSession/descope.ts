import { createRemoteJWKSet, decodeJwt, jwtVerify, type JWTPayload } from 'jose';
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { customers, type Customer } from '@/db/schema';
import { createDemoCustomer } from './demoSignup';
import { recordAgentVisit } from './knownAgents';

/**
 * THE GRAFT: Northbound's only agent code.
 *
 * A Cloudflare Worker from Agent Edge sits in front of the store and does the rest:
 * it verifies agents, serves the discovery files, sends agents on /login to the front
 * door, and blocks agents from payment methods. The front door gets the customer's
 * approval with Descope CIBA and puts the Descope access token in a DS cookie in the
 * agent's browser. This file decides whether to trust that token.
 *
 * It's a separate resolver, as lib/auth/session.ts asks: the opaque human session and
 * the agent's signed token never share a code path. No Next.js imports, so tests run in Node.
 */

export type AgentSession = {
  customer: Customer;
  /** Which agent is acting for the customer: the token's act.sub. */
  agent: string;
  /**
   * The email the token names. The customer was matched on it, so it is the same
   * address, but this is the one the token actually carries — what an interface
   * showing "acting for …" should say.
   */
  email: string;
  /** What the customer allowed it to do, from the token's scope claim. */
  scopes: string[];
};

let keys: { url: string; issuer: string; jwks: ReturnType<typeof createRemoteJWKSet> } | undefined;

async function descopeKeys(discoveryUrl: string) {
  if (keys?.url !== discoveryUrl) {
    const response = await fetch(discoveryUrl, { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`Descope discovery failed (${response.status})`);
    const discovery = (await response.json()) as { issuer: string; jwks_uri: string };
    keys = { url: discoveryUrl, issuer: discovery.issuer, jwks: createRemoteJWKSet(new URL(discovery.jwks_uri)) };
  }
  return keys;
}

/** Test hook. */
export function resetAgentSessionCache(): void {
  keys = undefined;
}

/**
 * The issuer Descope publishes, for the documents that have to name the authorization
 * server: the protected resource metadata for the agent API, and poppy.json.
 *
 * FROM THE SAME PLACE THE VERIFIER READS IT. Tokens are checked against this exact string
 * (jwtVerify below is given `issuer`), so a document advertising a different one would
 * send agents to get tokens this store then rejects — with nothing in the refusal to say
 * why. Reading it here rather than from a second setting is what makes them agree.
 *
 * Null when DESCOPE_DISCOVERY_URL is not set or Descope cannot be reached. The caller
 * decides what that means for its own document; this is not a place to invent an issuer.
 */
export async function descopeIssuer(): Promise<string | null> {
  const discoveryUrl = process.env.DESCOPE_DISCOVERY_URL;
  if (!discoveryUrl) return null;
  try {
    return (await descopeKeys(discoveryUrl)).issuer;
  } catch {
    return null;
  }
}

/**
 * Asks Descope whether this token is still live, instead of trusting the signature alone.
 *
 * A signature only says the token was genuine when it was minted. Revoke the agent's
 * access, or sign the Session out, and the token keeps verifying offline until it
 * expires — which for Descope is typically an hour. Poppy draft 0.2 §4.9 is explicit:
 * "Companies SHOULD check on each request whether the Session is still signed in, so
 * sign-out takes effect right away. A Company that doesn't SHOULD use much shorter
 * Session Token lifetimes, such as a few minutes."
 *
 * RFC 7662 introspection, on the Inbound App route. An inactive token comes back as
 * `{"active": false}` rather than an error, so a false here is a real answer.
 *
 * UNCONFIGURED, THIS IS SKIPPED. Without client credentials the store verifies offline
 * exactly as before, which keeps the storefront runnable with nothing but a discovery
 * URL — and puts it on the second branch of that SHOULD, where short lifetimes are the
 * price.
 *
 * WHEN DESCOPE CANNOT BE REACHED, IT FAILS CLOSED. The caller treats a throw as a
 * rejected token. That is the conservative reading of a revocation check and matches
 * this file's contract, but it is a real trade: an outage at Descope signs every agent
 * out until it passes. A store that would rather keep serving should catch here and
 * fall back to the offline result, and accept that a revoked token survives until it
 * expires.
 */
async function stillSignedIn(token: string): Promise<boolean> {
  const clientId = process.env.DESCOPE_INTROSPECT_CLIENT_ID;
  const clientSecret = process.env.DESCOPE_INTROSPECT_CLIENT_SECRET;
  if (!clientId || !clientSecret) return true;

  const base = process.env.DESCOPE_BASE_URL || 'https://api.descope.com';
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const response = await fetch(`${base}/oauth2/v1/apps/introspect`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${credentials}`,
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body: new URLSearchParams({ token, token_type_hint: 'access_token' }),
  });

  if (!response.ok) throw new Error(`Descope introspection failed (${response.status})`);

  const body = (await response.json()) as { active?: unknown };
  return body.active === true;
}

/**
 * The resource identifiers this store will accept a token for.
 *
 * ONE SETTING, BUT A LIST, SO THE IDENTIFIER CAN EVER BE CHANGED. The audience is minted
 * by the front door and checked here, in two separately deployed places, and a token is
 * good for an hour. Move them one at a time and whichever goes second spends that hour
 * rejecting every live agent; move them "together" and the gap is however long the two
 * deploys are apart. There is no ordering of a single value that does not break.
 *
 * With a list there is: add the new identifier, deploy, move the front door, then drop the
 * old one. Every step is safe on its own, and the only moment both are accepted is the
 * window in the middle — which is the point of it.
 *
 * jose takes `audience` as a string or an array and passes a token matching ANY of them,
 * so the list is a widening, never a weakening of the check. Empty or unset stays
 * undefined, which skips the check entirely, exactly as before.
 */
function acceptedAudiences(): string | string[] | undefined {
  const configured = (process.env.DESCOPE_AUDIENCE ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (configured.length === 0) return undefined;
  return configured.length === 1 ? configured[0] : configured;
}

/**
 * The token's claims, read WITHOUT verifying it, to describe a rejection on the log.
 *
 * NOT A CHECK, AND NOTHING MAY ACT ON IT. Anyone can write any claims into an unsigned
 * token; jwtVerify is still the only thing that decides. It is decoded separately from
 * that call so the claims appear for the tokens actually worth debugging — the ones that
 * fail verification, where jwtVerify returns no payload to log.
 */
function peekClaims(token: string): Record<string, unknown> | null {
  try {
    return decodeJwt(token) as Record<string, unknown>;
  } catch {
    // Not a JWT at all. The rejection below then reports nulls for iss, aud and exp, which
    // is itself the answer: nothing arrived that could carry them.
    return null;
  }
}

/**
 * What a token amounts to here: a session, or the reason there isn't one.
 *
 * The reason is carried out rather than only logged so a deployment can choose to tell
 * the agent as well (lib/api/bearer.ts, AGENT_DEBUG_REFUSALS). It is a sentence for a
 * person, not a code to branch on — nothing should match against these strings.
 */
export type AgentTokenResult =
  | { session: AgentSession; reason?: undefined }
  | { session: null; reason: string };

/**
 * One line per refusal, so a token that doesn't sign an agent in always says why.
 *
 * Every refusal below went through here. Before, most of them were silent: a token with
 * no email claim, the wrong scopes, or no matching customer produced an agent that simply
 * wasn't signed in, with nothing in the log to say which guard turned it away.
 */
function reject(reason: string, detail?: Record<string, unknown>): AgentTokenResult {
  console.warn(JSON.stringify({ event: 'agent_token_rejected', reason, ...detail }));
  return { session: null, reason };
}

/**
 * The session a token is good for, or null. The ordinary way to ask.
 *
 * Callers that want to explain a refusal use inspectAgentToken below; everything else
 * only cares whether there is a session, and null is the whole answer.
 */
export async function resolveAgentToken(token: string): Promise<AgentSession | null> {
  return (await inspectAgentToken(token)).session;
}

/**
 * Fails closed: no DESCOPE_DISCOVERY_URL, a bad signature, the wrong issuer or audience,
 * an expired token, a missing email or act claim, neither Northbound scope, a token Descope
 * no longer considers active, or no matching customer all refuse — each of them naming
 * itself on the log, and in the `reason` this returns.
 */
export async function inspectAgentToken(token: string): Promise<AgentTokenResult> {
  // Read here rather than at the rejection below, because a token that fails verification is
  // exactly the one worth describing and jwtVerify returns no payload for it. The token itself
  // is never logged: it is a live credential, replayable against this store until it expires.
  const claims = peekClaims(token);

  if (!token) return reject('no token');
  const discoveryUrl = process.env.DESCOPE_DISCOVERY_URL;
  if (!discoveryUrl) return reject('DESCOPE_DISCOVERY_URL is not set');

  try {
    const { issuer, jwks } = await descopeKeys(discoveryUrl);
    const audience = acceptedAudiences();

    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, jwks, { issuer, audience }));
    } catch (error) {
      // jose names the claim that disagreed but neither of the two values, which is the
      // whole question when a token is minted for one resource and checked against
      // another. `expected` is this store's configuration, `got` is what the front door
      // actually sent; `aud` passes when the token names ANY of the expected ones, so an
      // aud failure during a migration shows both lists side by side and says which step
      // has not been taken.
      return reject(String(error), {
        expected: { iss: issuer, aud: audience ?? null },
        got: { iss: claims?.iss ?? null, aud: claims?.aud ?? null, exp: claims?.exp ?? null },
      });
    }

    const agent = (payload.act as { sub?: unknown } | undefined)?.sub;
    if (typeof payload.email !== 'string') return reject('token carries no email claim');
    if (typeof agent !== 'string') return reject('token carries no act.sub claim');

    // The customer approved read-only access (orders:read) or a purchase (orders:write). A token
    // with neither wasn't issued for shopping here, so it doesn't sign an agent in.
    const scopes = typeof payload.scope === 'string' ? payload.scope.split(' ').filter(Boolean) : [];
    if (!scopes.includes('orders:read') && !scopes.includes('orders:write')) {
      return reject('token carries neither orders:read nor orders:write', { scopes });
    }

    // Last, and only once the cheap local checks have passed: a forged or expired token
    // is rejected here without ever being sent to Descope.
    if (!(await stillSignedIn(token))) return reject('not active at Descope');

    // Descope's user and Northbound's customer are the same person when their emails match.
    const [existing] = await db.select().from(customers)
      .where(sql`lower(${customers.email}) = ${payload.email.toLowerCase()}`)
      .limit(1);
    const customer = existing ?? (process.env.DEMO_AUTO_SIGNUP === 'true'
      ? await createDemoCustomer(payload.email, typeof payload.name === 'string' ? payload.name : undefined)
      : undefined);
    if (!customer) {
      return reject('no Northbound customer with that email', {
        email: payload.email,
        demoAutoSignup: process.env.DEMO_AUTO_SIGNUP === 'true',
      });
    }

    // Only once the token has fully passed. Recording a rejected token would let
    // anyone with a forged JWT write rows into a customer's list of assistants.
    await recordAgentVisit(customer.id, agent, scopes);

    // `agent` is the token's act.sub; `azp` is the OAuth client the token was issued to.
    //
    // BOTH, BECAUSE WHICH ONE NAMES THE AGENT IS NOT SETTLED. agentProducts.ts reads act.sub
    // as a client ID on the strength of Descope's token exchange documentation, but this
    // token comes from CIBA or the device flow, where Descope documents neither act nor how
    // it relates to azp. Logging them side by side is what will answer it, from a real token
    // rather than from an assumption. Both are identifiers, not credentials, so this line
    // stays once the question is settled.
    //
    // The customer is named by row id rather than by email. The id answers the only question
    // this log is for — which customer an agent acted for — and an email on every accepted
    // request is the same personal data this function stopped printing beside the token.
    console.log(JSON.stringify({
      event: 'agent_token_accepted',
      agent,
      azp: typeof payload.azp === 'string' ? payload.azp : null,
      customer: customer.id,
      scopes,
    }));
    return { session: { customer, agent, email: payload.email, scopes } };
  } catch (error) {
    // Discovery, introspection and the database land here.
    return reject(String(error));
  }
}
