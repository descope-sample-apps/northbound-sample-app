import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Customer } from '@/db/schema';
import { resolveSession, SESSION_COOKIE, SESSION_TTL_MS } from './session';
import { resolveAgentToken, type AgentSession } from '@/lib/agentSession/descope';

/** The cookie the agent-ready front door sets in an agent's browser. */
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
const getHumanCustomer = cache(async (): Promise<Customer | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? resolveSession(token) : null;
});

/**
 * An AI agent signed in for a customer, or null. A person's own session always wins,
 * so a customer who signs in themselves is never treated as an agent.
 */
export const getAgentSession = cache(async (): Promise<AgentSession | null> => {
  if (await getHumanCustomer()) return null;
  const token = (await cookies()).get(AGENT_COOKIE)?.value;
  return token ? resolveAgentToken(token) : null;
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
  (await cookies()).delete(SESSION_COOKIE);
  // Signing out from an agent's browser ends the agent's session here too.
  (await cookies()).delete(AGENT_COOKIE);
}
