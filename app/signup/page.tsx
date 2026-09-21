import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthForm } from '@/components/brand/AuthForm';
import { getCurrentCustomer } from '@/lib/auth/session-cookie';
import { signupAction } from './actions';

export default async function SignupPage() {
  if (await getCurrentCustomer()) redirect('/');

  return (
    <main className="mx-auto max-w-md px-6 py-20">
      <h1 className="display text-3xl">Create an account</h1>
      <p className="mt-2 text-sm text-muted">
        One account for orders, addresses, and saved payment methods.
      </p>

      <div className="mt-8 rounded-lg border border-rule bg-surface p-7">
        <AuthForm
          action={signupAction}
          mode="signup"
          submitLabel="Create account"
          pendingLabel="Creating…"
        />
      </div>

      <p className="mt-6 text-sm text-muted">
        Already have one?{' '}
        <Link href="/login" className="font-medium text-ember hover:underline">
          Sign in
        </Link>
      </p>
    </main>
  );
}
