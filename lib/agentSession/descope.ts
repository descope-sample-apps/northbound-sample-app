import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { customers, type Customer } from '@/db/schema';

/**
 * THE GRAFT. Everything Northbound knows about AI agents lives in this directory.
 *
 * Agents don't sign in here. They connect through the agent-ready front door,
 * which runs a Descope CIBA request, the customer approves on their own device,
 * and the front door sets the resulting Descope access token as a cookie in the
 * agent's browser. This module turns that cookie into a customer, plus a record
 * of which agent is acting for them.
 *
 * It is a separate resolver on purpose, as lib/auth/session.ts asked for: the
 * opaque human session and the agent's signed token never share a code path.
 *
 * No Next.js imports, so it runs in plain Node tests.
 */

export type AgentIdentity = {
  /** The inbound app the token was issued to (azp). Names the platform only for trusted platforms. */
  clientId: string | null;
  /** The token's act claim, when Descope includes one. */
  actor: unknown;
  /** The front door's per-request agent ID, when Descope includes it as a claim. */
  agentId: string | null;
};

export type AgentSession = { customer: Customer; agent: AgentIdentity };

type Discovery = { issuer: string; jwks_uri: string; userinfo_endpoint?: string };

let discovery: { url: string; value: Discovery; jwks: ReturnType<typeof createRemoteJWKSet> } | undefined;

async function loadDiscovery(url: string) {
  if (discovery?.url === url) return discovery;
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`Descope discovery failed (${response.status})`);
  const value = (await response.json()) as Discovery;
  discovery = { url, value, jwks: createRemoteJWKSet(new URL(value.jwks_uri)) };
  return discovery;
}

/** Test hook. */
export function resetAgentSessionCache(): void {
  discovery = undefined;
}

/** Descope access tokens may leave the email out; userinfo has it when the customer consented. */
async function emailFor(token: string, payload: JWTPayload, userinfoEndpoint?: string): Promise<string | null> {
  if (typeof payload.email === 'string') return payload.email;
  if (!userinfoEndpoint) return null;
  const response = await fetch(userinfoEndpoint, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) return null;
  const info = (await response.json()) as { email?: unknown };
  return typeof info.email === 'string' ? info.email : null;
}

/**
 * Fails closed: an unconfigured project, a bad signature, the wrong issuer or audience,
 * an expired token, or no matching customer all resolve to null.
 */
export async function resolveAgentToken(token: string): Promise<AgentSession | null> {
  const discoveryUrl = process.env.DESCOPE_DISCOVERY_URL;
  if (!token || !discoveryUrl) return null;

  try {
    const { value, jwks } = await loadDiscovery(discoveryUrl);
    const { payload } = await jwtVerify(token, jwks, {
      issuer: value.issuer,
      audience: process.env.DESCOPE_AUDIENCE || undefined,
    });

    const email = await emailFor(token, payload, value.userinfo_endpoint);
    if (!email) return null;

    // Descope's user and Northbound's customer are the same person when their emails match.
    const [customer] = await db.select().from(customers)
      .where(sql`lower(${customers.email}) = ${email.toLowerCase()}`)
      .limit(1);
    if (!customer) return null;

    return {
      customer,
      agent: {
        clientId: typeof payload.azp === 'string' ? payload.azp
          : typeof payload.client_id === 'string' ? payload.client_id : null,
        actor: payload.act ?? null,
        agentId: typeof payload.agent_id === 'string' ? payload.agent_id : null,
      },
    };
  } catch (error) {
    console.warn(JSON.stringify({ event: 'agent_token_rejected', reason: String(error) }));
    return null;
  }
}
