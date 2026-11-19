import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Customer } from '@/db/schema';
import { resolveSession, SESSION_COOKIE, SESSION_TTL_MS } from './session';
import { resolveAgentToken, type AgentSession } from '@/lib/agentSession/descope';
import {
  BROWSER_SESSION_COOKIE,
  endBrowserJoin,
  resolveBrowserJoin,
} from '@/lib/agentSession/browserJoin';

/** The cookie the Agent Edge front door sets in an agent's browser. */
const AGENT_COOKIE = process.env.AGENT_SESSION_COOKIE || 'DS';

/**
 * Request-bound session helpers. Split from ./session so the pure session core
 * has no framework imports.
 *
 * Deliberately NOT Next.js middleware: middleware runs on the edge runtime and
 * cannot open a SQLite handle, so session validation happens here — in server
 * components, server actions, and route handlers. React's cache() memoizes it
 * per request so a page that asks three times still makes one query.
 */
/** A customer signed in themselves, ignoring any agent session. */
export const getHumanCustomer = cache(async (): Promise<Customer | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? resolveSession(token) : null;
});

/**
 * An AI agent signed in for a customer, or null. A person's own session always wins,
 * so a customer who signs in themselves is never treated as an agent.
 */
export const getAgentSession = cache(async (): Promise<AgentSession | null> => {
  if (await getHumanCustomer()) return null;
  const jar = await cookies();

  // Agent Edge's front door, which puts the Descope access token in the cookie itself.
  const token = jar.get(AGENT_COOKIE)?.value;
  if (token) return resolveAgentToken(token);

  // Poppy's own browser join (section 6). The cookie here is opaque — the token it
  // stands for never reached the browser — so resolving it is a lookup and then the
  // same token check, which is what makes a joined browser and a bearer token come out
  // of this function as the same AgentSession. Everything downstream that reads scopes
  // (lib/agentSession/stepUp.ts, lib/agentSession/accountChanges.ts) therefore gates
  // browsing without knowing the join exists.
  const joined = jar.get(BROWSER_SESSION_COOKIE)?.value;
  return joined ? resolveBrowserJoin(joined) : null;
});

/** The customer this request acts for, whether they're here themselves or through an agent. */
export const getCurrentCustomer = cache(async (): Promise<Customer | null> => {
  return (await getHumanCustomer()) ?? (await getAgentSession())?.customer ?? null;
});

export async function requireCustomer(): Promise<Customer> {
  const customer = await getCurrentCustomer();
  if (!customer) redirect('/login');
  return customer;
}

export async function setSessionCookie(token: string): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  // Signing out from an agent's browser ends the agent's session here too.
  jar.delete(AGENT_COOKIE);

  // And its Poppy join, which section 6 lists among the things that end the Session's
  // sign-in. Revoked server-side as well as dropped, so a copy of the cookie is dead:
  // deleting it only asks the browser to forget it.
  const joined = jar.get(BROWSER_SESSION_COOKIE)?.value;
  if (joined) {
    await endBrowserJoin(joined);
    jar.delete(BROWSER_SESSION_COOKIE);
  }
}
