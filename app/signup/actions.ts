'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { registerCustomer } from '@/lib/auth/register';
import { createSession } from '@/lib/auth/session';
import { setSessionCookie } from '@/lib/auth/session-cookie';
import { ServiceError } from '@/lib/services/errors';

export type SignupState = { error?: string };

export async function signupAction(
  _previous: SignupState,
  formData: FormData,
): Promise<SignupState> {
  let customerId: number;

  try {
    customerId = await registerCustomer({
      email: String(formData.get('email') ?? ''),
      name: String(formData.get('name') ?? ''),
      password: String(formData.get('password') ?? ''),
    });
  } catch (error) {
    if (error instanceof ServiceError) return { error: error.message };
    throw error;
  }

  const userAgent = (await headers()).get('user-agent') ?? undefined;
  await setSessionCookie(await createSession(customerId, userAgent));

  redirect('/');
}
