import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthForm } from '@/components/brand/AuthForm';
import { getCurrentCustomer } from '@/lib/auth/session-cookie';
import { loginAction } from './actions';

export default async function LoginPage() {
  if (await getCurrentCustomer()) redirect('/');

  return (
    <main className="mx-auto max-w-md px-6 py-20">
      <h1 className="display text-3xl">Sign in</h1>
      <p className="mt-2 text-sm text-muted">
        To see your orders, saved addresses, and cart.
      </p>

      <div className="mt-8 rounded-lg border border-rule bg-surface p-7">
        <AuthForm
          action={loginAction}
          mode="login"
          submitLabel="Sign in"
          pendingLabel="Signing in…"
        />
      </div>

      <p className="mt-6 text-sm text-muted">
        New here?{' '}
        <Link href="/signup" className="font-medium text-ember hover:underline">
          Create an account
        </Link>
      </p>

      {/*
        Demo accounts are listed by email only. The passwords live in the README
        and in db/seed/customers.ts — printing them on the sign-in page of an
        authentication demo sets exactly the wrong example.
      */}
      <div className="mt-10 border-t border-rule pt-6">
        <div className="text-[10px] font-semibold uppercase tracking-[0.13em] text-muted">
          Demo accounts
        </div>
        <ul className="mt-3 space-y-1.5 text-sm text-muted">
          <li><span className="text-ink">alice@example.com</span> — verified, with order history</li>
          <li><span className="text-ink">bob@example.com</span> — 2019 account, password held by the legacy backend</li>
          <li><span className="text-ink">carol@example.com</span> — signed up with Google, set a password later</li>
        </ul>
        <p className="mt-3 text-xs text-muted">Passwords are in the README.</p>
      </div>
    </main>
  );
}
