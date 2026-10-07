'use server';

import { redirect } from 'next/navigation';
import { cookies, headers } from 'next/headers';
import { verifyCredentials } from '@/lib/auth/verify';
import { createSession, revokeSession, SESSION_COOKIE } from '@/lib/auth/session';
import { clearSessionCookie, setSessionCookie } from '@/lib/auth/session-cookie';
import { completeExternalAuth, externalAuthRequestId } from '@/lib/agentSession/externalAuth';

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

  // Signing in for a Descope flow (External Authentication): hand back to Descope.
  if (formData.has('external_auth_req_id')) {
    const requestId = externalAuthRequestId(formData.get('external_auth_req_id'));
    let next: string;
    try {
      if (!requestId) throw new Error('malformed request ID');
      next = await completeExternalAuth(requestId, result.customerId);
    } catch {
      return { error: "You're signed in, but we couldn't finish the approval. Go back and try again." };
    }
    redirect(next);
  }

  redirect('/');
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
