import Link from 'next/link';
import { ButtonLink } from '@/components/brand/Button';
import { RevokeAgent } from '@/components/brand/RevokeAgent';
import { requireCustomer } from '@/lib/auth/session-cookie';
import { browserContext } from '@/lib/oauth/types';
import { describe, listActivity, listAgentsSeen } from '@/lib/services/audit';

const when = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
});

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const customer = await requireCustomer();
  const ctx = browserContext(customer.id);

  const agentParam = (await searchParams).agent;
  const agentId = Array.isArray(agentParam) ? agentParam[0] : agentParam;

  const [events, agents] = await Promise.all([
    listActivity(ctx, { agentId }),
    listAgentsSeen(ctx),
  ]);

  const firstName = customer.name.split(' ')[0];

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="display text-3xl">Account activity</h1>
      <p className="mt-2 max-w-[62ch] text-sm leading-relaxed text-muted">
        Everything that has happened on your account, whether you did it or an
        agent did it for you. Anything an agent did says so.
      </p>

      {agents.length > 0 && (
        <section className="mt-8">
          <div className="text-[10px] font-semibold uppercase tracking-[0.13em] text-muted">
            Agents with access
          </div>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {agents.map((agent) => (
              <li key={agent.agentId} className="rounded-lg border border-rule bg-surface p-5">
                <div className="display text-[15px]">{agent.displayName}</div>
                <p className="mt-1 text-xs text-muted">
                  {agent.eventCount} action{agent.eventCount === 1 ? '' : 's'} ·
                  last {when.format(agent.lastSeen)}
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-4">
                  <RevokeAgent agentId={agent.agentId} displayName={agent.displayName} />
                  <Link
                    href={`/account/activity?agent=${encodeURIComponent(agent.agentId)}`}
                    className="text-[10px] font-semibold uppercase tracking-[0.13em] text-muted hover:text-spruce"
                  >
                    Only this agent
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {agentId && (
        <p className="mt-8 text-sm">
          Showing one agent.{' '}
          <Link href="/account/activity" className="text-ember hover:underline">
            Show everything
          </Link>
        </p>
      )}

      {events.length === 0 ? (
        <p className="mt-10 text-muted">Nothing has happened yet.</p>
      ) : (
        <ul className="mt-8 divide-y divide-rule border-y border-rule">
          {events.map((event) => (
            <li key={event.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-4">
              {/* An agent's action is marked; the customer's own is not, so the
                  difference is visible without decoding a column. */}
              <span
                className={`rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] ${
                  event.agentId ? 'bg-ember/10 text-ember' : 'bg-ink/5 text-muted'
                }`}
              >
                {event.agentId ? 'Agent' : 'You'}
              </span>
              <span className="min-w-0 flex-1 text-sm leading-relaxed">
                {describe(event, firstName)}
              </span>
              <span className="text-xs text-muted tabular-nums">
                {when.format(event.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-10 border-t border-rule pt-6">
        <ButtonLink href="/account" variant="secondary">Back to account</ButtonLink>
      </div>
    </main>
  );
}
