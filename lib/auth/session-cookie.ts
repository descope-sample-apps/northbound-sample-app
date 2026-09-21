import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Customer } from '@/db/schema';
import { resolveSession, SESSION_COOKIE, SESSION_TTL_MS } from './session';

/**
 * Request-bound session helpers. Split from ./session so the pure session core
 * has no framework imports.
 *
 * Deliberately NOT Next.js middleware: middleware runs on the edge runtime and
 * cannot open a SQLite handle, so session validation happens here — in server
 * components, server actions, and route handlers. React's cache() memoizes it
 * per request so a page that asks three times still makes one query.
 */
export const getCurrentCustomer = cache(async (): Promise<Customer | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? resolveSession(token) : null;
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
}
