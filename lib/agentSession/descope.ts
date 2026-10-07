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
 * Fails closed: no DESCOPE_DISCOVERY_URL, a bad signature, the wrong issuer or audience,
 * an expired token, a missing email or act claim, neither Northbound scope, or no matching
 * customer all resolve to null.
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

    // Descope's user and Northbound's customer are the same person when their emails match.
    const [existing] = await db.select().from(customers)
      .where(sql`lower(${customers.email}) = ${payload.email.toLowerCase()}`)
      .limit(1);
    const customer = existing ?? (process.env.DEMO_AUTO_SIGNUP === 'true'
      ? await createDemoCustomer(payload.email, typeof payload.name === 'string' ? payload.name : undefined)
      : undefined);
    return customer ? { customer, agent, scopes } : null;
  } catch (error) {
    console.warn(JSON.stringify({ event: 'agent_token_rejected', reason: String(error) }));
    return null;
  }
}
