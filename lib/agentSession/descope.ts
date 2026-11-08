import { createRemoteJWKSet, jwtVerify } from 'jose';
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { customers, type Customer } from '@/db/schema';
import { createDemoCustomer } from './demoSignup';

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
 * Fails closed: no DESCOPE_DISCOVERY_URL, a bad signature, the wrong issuer or audience,
 * an expired token, a missing email or act claim, neither Northbound scope, a token Descope
 * no longer considers active, or no matching customer all resolve to null.
 */
export async function resolveAgentToken(token: string): Promise<AgentSession | null> {
  const discoveryUrl = process.env.DESCOPE_DISCOVERY_URL;
  if (!token || !discoveryUrl) return null;

  try {
    const { issuer, jwks } = await descopeKeys(discoveryUrl);
    const { payload } = await jwtVerify(token, jwks, { issuer, audience: process.env.DESCOPE_AUDIENCE || undefined });
    const agent = (payload.act as { sub?: unknown } | undefined)?.sub;
    if (typeof payload.email !== 'string' || typeof agent !== 'string') return null;

    // The customer approved read-only access (orders:read) or a purchase (orders:write). A token
    // with neither wasn't issued for shopping here, so it doesn't sign an agent in.
    const scopes = typeof payload.scope === 'string' ? payload.scope.split(' ').filter(Boolean) : [];
    if (!scopes.includes('orders:read') && !scopes.includes('orders:write')) return null;

    // Last, and only once the cheap local checks have passed: a forged or expired token
    // is rejected here without ever being sent to Descope.
    if (!(await stillSignedIn(token))) {
      console.warn(JSON.stringify({ event: 'agent_token_rejected', reason: 'not active at Descope' }));
      return null;
    }

    // Descope's user and Northbound's customer are the same person when their emails match.
    const [existing] = await db.select().from(customers)
      .where(sql`lower(${customers.email}) = ${payload.email.toLowerCase()}`)
      .limit(1);
    const customer = existing ?? (process.env.DEMO_AUTO_SIGNUP === 'true'
      ? await createDemoCustomer(payload.email, typeof payload.name === 'string' ? payload.name : undefined)
      : undefined);
    return customer ? { customer, agent, email: payload.email, scopes } : null;
  } catch (error) {
    console.warn(JSON.stringify({ event: 'agent_token_rejected', reason: String(error) }));
    return null;
  }
}
