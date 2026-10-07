import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthForm } from '@/components/brand/AuthForm';
import { getCurrentCustomer, getHumanCustomer } from '@/lib/auth/session-cookie';
import { completeExternalAuth, externalAuthRequestId } from '@/lib/agentSession/externalAuth';
import { loginAction } from './actions';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Optional: Descope's External Authentication action sends customers here with an
  // external_auth_req_id to approve an agent (see lib/agentSession/externalAuth.ts).
  // Without one, this is the ordinary sign-in page.
  const requestId = externalAuthRequestId((await searchParams).external_auth_req_id);
  if (requestId) {
    const customer = await getHumanCustomer();
    if (customer) redirect(await completeExternalAuth(requestId, customer.id));
  } else if (await getCurrentCustomer()) {
    redirect('/');
  }

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
          hidden={requestId ? { external_auth_req_id: requestId } : undefined}
        />
      </div>

      <p className="mt-6 text-sm text-muted">
        New here?{' '}
        <Link href="/signup" className="font-medium text-ember hover:underline">
          Create an account
        </Link>
      </p>

    </main>
  );
}
