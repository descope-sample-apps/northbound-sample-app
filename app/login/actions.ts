'use server';

import { redirect } from 'next/navigation';
import { cookies, headers } from 'next/headers';
import { verifyCredentials } from '@/lib/auth/verify';
import { createSession, revokeSession, SESSION_COOKIE } from '@/lib/auth/session';
import { clearSessionCookie, setSessionCookie } from '@/lib/auth/session-cookie';

export type LoginState = { error?: string };

/**
 * SECURITY BOUNDARY — where a customer's credential is entered.
 *
 * The password arrives here from Northbound's own form, over the same origin,
 * and is handed straight to verifyCredentials. It is never stored, never
 * logged, and never forwarded anywhere except — for legacy-backed accounts —
 * the legacy service, server side.
 *
 * Nothing on this path is reachable by a third party. When sub-project B adds
 * agent access, agents will obtain a token through OAuth; they will never see
 * this form, this action, or this value.
 */
export async function loginAction(
  _previous: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');

  if (!email || !password) {
    return { error: 'Enter your email and password.' };
  }

  const result = await verifyCredentials(email, password);

  // One message for every failure. A distinct "no such account" would turn
  // this form into an account enumerator.
  if (!result.ok || !result.customerId) {
    return { error: 'That email and password do not match an account.' };
  }

  const userAgent = (await headers()).get('user-agent') ?? undefined;
  await setSessionCookie(await createSession(result.customerId, userAgent));

  redirect(safeNext(formData.get('next')));
}

/**
 * Where to send the customer after signing in.
 *
 * Only a same-origin PATH is honoured — it must start with a single `/` and
 * must not start with `//`, which browsers read as a protocol-relative URL to
 * another host. Anything else falls back to the home page.
 *
 * Without this, `?next=` is an open redirect, and an open redirect on a login
 * page is a phishing primitive: the link looks like Northbound, the password
 * goes to Northbound, and the customer lands somewhere else entirely.
 */
function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === 'string' ? value.trim() : '';
  if (!next.startsWith('/') || next.startsWith('//')) return '/';
  return next;
}

/**
 * Revokes server-side AND clears the cookie.
 *
 * Order matters: revoking first means that even if the browser keeps a copy of
 * the cookie — or one was captured earlier — it is already dead by the time
 * this returns. Clearing the cookie alone would leave a working session token
 * in the wild until it expired.
 */
export async function logoutAction(): Promise<void> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) await revokeSession(token);
  await clearSessionCookie();
  redirect('/login');
}
