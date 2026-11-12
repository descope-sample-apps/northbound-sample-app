import { ButtonLink } from '@/components/brand/Button';
import { requireCustomer } from '@/lib/auth/session-cookie';
import { listAssistants } from '@/lib/agentSession/knownAgents';
import { assistantAnchor } from '@/lib/agentSession/agentProducts';

const approvedOn = new Intl.DateTimeFormat('en-US', {
  year: 'numeric', month: 'long', day: 'numeric',
});
const lastActive = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
});

export default async function AssistantsPage() {
  const customer = await requireCustomer();
  const assistants = await listAssistants(customer.id);

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="display text-3xl">AI assistants</h1>
      <p className="mt-3 max-w-prose text-sm text-muted">
        Assistants you have approved to shop at Northbound for you. Each one signs in
        with its own access, separately from your password, and you can see here
        exactly what you allowed it to do. Anything Northbound doesn&rsquo;t recognize is
        shown as a third-party agent with the client ID its token carries.
      </p>

      {assistants.length === 0 ? (
        <p className="mt-10 rounded-lg border border-rule bg-surface p-6 text-muted">
          No AI assistant has signed in to your account.
        </p>
      ) : (
        <ul className="mt-8 grid gap-4">
          {assistants.map((assistant) => (
            <li
              key={assistant.id}
              // What an order's "by <name>" link lands on. scroll-mt keeps the card clear
              // of the top edge when the browser jumps to it.
              id={assistantAnchor(assistant.id)}
              className="scroll-mt-8 rounded-lg border border-rule bg-surface p-6"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <span className="text-[10px] font-semibold uppercase tracking-[0.13em] text-ember">
                  {assistant.product ? assistant.product.name : 'Third-party agent'}
                </span>
                <span className="text-xs text-muted">
                  Last active {lastActive.format(assistant.lastSeenAt)}
                </span>
              </div>

              {/*
                The headline is who operates it, because that is what a customer can judge.
                An assistant this store has no name for shows its client ID instead — the
                thing that is always true — rather than a reassuring guess.
              */}
              <p className="display mt-2 text-[15px] break-all">
                {assistant.product ? assistant.product.domain : assistant.id}
              </p>
              <p className="mt-1 text-xs text-muted">
                {assistant.product && <>Client {assistant.id} · </>}
                Approved {approvedOn.format(assistant.firstSeenAt)}
                {assistant.ordersPlaced > 0 && (
                  <>
                    {' · '}
                    <a href="/orders" className="underline underline-offset-2 hover:text-spruce">
                      {assistant.ordersPlaced === 1
                        ? '1 order placed'
                        : `${assistant.ordersPlaced} orders placed`}
                    </a>
                  </>
                )}
              </p>

              <div className="mt-5 border-t border-rule pt-4">
                <h2 className="text-[10px] font-semibold uppercase tracking-[0.13em] text-muted">
                  What it can do
                </h2>
                <ul className="mt-2 grid gap-1.5 text-sm">
                  {assistant.allowed.map((permission) => (
                    <li key={permission} className="flex gap-2.5">
                      <span aria-hidden className="text-spruce">✓</span>
                      <span>{permission}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-muted">
                  It cannot change your profile, your saved addresses, or your payment
                  methods. To stop it, remove its access where you approved it.
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-8">
        <ButtonLink href="/account" variant="secondary">Back to account</ButtonLink>
      </div>
    </main>
  );
}
