'use server';

import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { revokeSession, SESSION_COOKIE } from '@/lib/auth/session';
import { clearSessionCookie } from '@/lib/auth/session-cookie';

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
