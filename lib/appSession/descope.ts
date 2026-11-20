import { createRemoteJWKSet, jwtVerify } from 'jose';
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { customers, type Customer } from '@/db/schema';
import { createDemoCustomer } from '@/lib/agentSession/demoSignup';

/**
 * The customer's own Descope session, as the Northbound iOS app holds it.
 *
 * THIS IS NOT THE AGENT PATH, AND MUST NEVER ACCEPT WHAT THE AGENT PATH ACCEPTS. Agents get
 * tokens from an inbound app (an issuer under /v1/apps/) that name them in `act`, and they
 * are confined to the scopes the customer approved on /api/agent/v1. The app API answers
 * for the customer in person: their orders, the assistants acting for them. A token that
 * names an actor, or that came from an inbound app, is an agent's however valid its
 * signature, and is refused here.
 */
export type CustomerSession = { customer: Customer; email: string };

let keys: { url: string; jwks: ReturnType<typeof createRemoteJWKSet> } | undefined;

export function resetAppSessionCache(): void {
  keys = undefined;
}

function baseUrl(): string {
  return (process.env.DESCOPE_BASE_URL || 'https://api.descope.com').replace(/\/+$/, '');
}

function jwksFor(projectId: string) {
  const url = `${baseUrl()}/${projectId}/.well-known/jwks.json`;
  if (keys?.url !== url) keys = { url, jwks: createRemoteJWKSet(new URL(url)) };
  return keys.jwks;
}

/**
 * Which issuers a session token may name. Descope puts the project under its base URL,
 * which with a custom domain is that domain, and older tokens carry the bare project ID.
 * DESCOPE_SESSION_ISSUERS overrides both, comma-separated.
 */
function acceptedIssuers(projectId: string): string[] {
  const configured = process.env.DESCOPE_SESSION_ISSUERS?.split(',').map((s) => s.trim()).filter(Boolean);
  return configured?.length ? configured : [`${baseUrl()}/${projectId}`, projectId];
}

function reject(reason: string): null {
  console.warn(JSON.stringify({ event: 'app_token_rejected', reason }));
  return null;
}

/** The customer a session token belongs to, or null. Fails closed. */
export async function resolveCustomerToken(token: string): Promise<CustomerSession | null> {
  const projectId = process.env.DESCOPE_PROJECT_ID;
  if (!projectId) return reject('DESCOPE_PROJECT_ID is not set');

  let payload;
  try {
    ({ payload } = await jwtVerify(token, jwksFor(projectId), { issuer: acceptedIssuers(projectId) }));
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    return reject(`not verified: ${typeof code === 'string' ? code : 'invalid token'}`);
  }

  if (payload.act !== undefined) return reject('token names an actor, so it is an agent token');
  if (typeof payload.iss === 'string' && payload.iss.includes('/v1/apps/')) {
    return reject('token is from an inbound app, so it is an agent token');
  }
  if (typeof payload.email !== 'string' || !payload.email) {
    return reject('no email claim; add it to the session JWT template');
  }

  const email = payload.email;
  const [existing] = await db.select().from(customers)
    .where(sql`lower(${customers.email}) = ${email.toLowerCase()}`)
    .limit(1);
  const customer = existing ?? (process.env.DEMO_AUTO_SIGNUP === 'true'
    ? await createDemoCustomer(email, typeof payload.name === 'string' ? payload.name : undefined)
    : undefined);
  if (!customer) return reject('no Northbound customer with that email');

  return { customer, email };
}
