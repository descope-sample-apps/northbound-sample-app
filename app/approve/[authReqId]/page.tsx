import { notFound, redirect } from 'next/navigation';
import { ApprovalDecision } from '@/components/brand/ApprovalDecision';
import { getCurrentCustomer } from '@/lib/auth/session-cookie';
import { getPendingRequest } from '@/lib/oauth/local/ciba';
import { parseMoneyValue, type AuthorizationDetail } from '@/lib/oauth/types';
import { formatCents } from '@/lib/money';

const SCOPE_LABELS: Record<string, string> = {
  'products:read': 'Browse the catalogue',
  'orders:read': 'See your past orders',
  'cart:read': 'See what is in your cart',
  'cart:write': 'Add and remove items from your cart',
  'checkout': 'Place orders',
  'profile:read': 'See your name and email',
  'addresses:write': 'Add or change a delivery address',
  'payment_methods:write': 'Add or remove a payment method',
};

export default async function ApprovePage({
  params,
}: {
  params: Promise<{ authReqId: string }>;
}) {
  const { authReqId } = await params;
  const request = await getPendingRequest(authReqId);
  if (!request) notFound();

  // The customer signs in with the login they already use. The agent is not
  // involved in this step and never sees the credential.
  const customer = await getCurrentCustomer();
  if (!customer) redirect(`/login?next=${encodeURIComponent(`/approve/${authReqId}`)}`);

  // Scoped: a request that resolved to someone else is not this customer's to
  // answer, and must not even be readable.
  if (request.customerId !== customer.id) notFound();

  const details = request.authorizationDetails
    ? (JSON.parse(request.authorizationDetails) as AuthorizationDetail[])
    : [];
  const purchase = details.find((d) => d.type === 'purchase');
  const scopes = request.scope.split(/\s+/).filter(Boolean);

  return (
    <main className="mx-auto max-w-lg px-6 py-16">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ember">
        Approval requested
      </p>

      <h1 className="display mt-3 text-3xl leading-tight">
        {request.bindingMessage}
      </h1>

      {/* The customer's half of the check. Their agent should have told them
          this number; if it did not, they are looking at somebody else's
          request and should decline. */}
      <div className="mt-6 flex items-center gap-4 rounded-[5px] border border-rule bg-surface px-5 py-4">
        <div className="display text-3xl tracking-[0.2em] tabular-nums">
          {request.bindingCode}
        </div>
        <p className="text-xs leading-relaxed text-muted">
          Your agent should have shown you this code. If it did not, or it
          showed a different one, decline this request.
        </p>
      </div>

      <div className="mt-8 rounded-lg border border-rule bg-surface p-7">
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.13em] text-muted">
              Agent
            </div>
            <div className="display mt-1 text-lg">{request.agentDisplayName}</div>
          </div>
          <span
            className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] ${
              request.agentVerified
                ? 'bg-spruce/10 text-spruce'
                : 'bg-ember/10 text-ember'
            }`}
          >
            {request.agentVerified ? 'Verified' : 'Self-declared'}
          </span>
        </div>

        {!request.agentVerified && (
          <p className="mt-3 text-sm leading-relaxed text-ember">
            This agent did not prove its identity. It told us who it is, and we
            have no way to check. It cannot place orders.
          </p>
        )}
        {request.agentDirectoryUrl && (
          <p className="mt-3 break-all text-xs text-muted">
            Signed with a key published at {new URL(request.agentDirectoryUrl).host}
          </p>
        )}

        <div className="mt-6 border-t border-rule pt-5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.13em] text-muted">
            Acting for
          </div>
          <p className="mt-1 text-sm">
            {customer.name} · {customer.email}
          </p>
        </div>

        <div className="mt-6 border-t border-rule pt-5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.13em] text-muted">
            What it will be able to do
          </div>
          <ul className="mt-3 space-y-1.5 text-sm">
            {scopes.map((scope) => (
              <li key={scope} className="flex gap-2">
                <span className="text-spruce">·</span>
                <span>{SCOPE_LABELS[scope] ?? scope}</span>
              </li>
            ))}
          </ul>

          {purchase ? (
            <p className="mt-4 rounded-[5px] bg-spruce/10 px-4 py-3 text-sm text-spruce">
              Can spend up to{' '}
              <strong>{formatCents(parseMoneyValue(purchase.max_amount.value))}</strong>{' '}
              per {purchase.period === 'P7D' ? 'week' : purchase.period} at{' '}
              {purchase.merchant}.
            </p>
          ) : (
            <p className="mt-4 rounded-[5px] bg-ink/5 px-4 py-3 text-sm text-muted">
              Cannot buy anything. Read-only access.
            </p>
          )}
        </div>

        <div className="mt-7 border-t border-rule pt-6">
          <ApprovalDecision authReqId={authReqId} />
        </div>
      </div>

      <p className="mt-6 text-xs leading-relaxed text-muted">
        You can revoke this at any time from your account, without signing out
        or changing your password.
      </p>
    </main>
  );
}
