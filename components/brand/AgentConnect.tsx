'use client';

import { useActionState } from 'react';
import { Button } from './Button';
import { Field } from './Field';
import { connectAgentAction, type ConnectState } from '@/app/agents/actions';

export type PlatformButton = {
  key: string;
  displayName: string;
  owner: string;
};

export function AgentConnect({ platforms }: { platforms: PlatformButton[] }) {
  const [state, formAction, pending] = useActionState<ConnectState, FormData>(
    connectAgentAction,
    {},
  );

  if (state.started) {
    return (
      <div className="rounded-lg border border-rule bg-surface p-7">
        <h2 className="display text-xl">Waiting for approval</h2>
        <p className="mt-3 text-sm leading-relaxed text-ink/75">
          We sent an approval request to the account holder. Nothing happens
          here until they approve it on their own device.
        </p>

        <dl className="mt-6 space-y-2 border-t border-rule pt-5 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Agent</dt>
            <dd className="text-right">{state.started.agentName}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Identity</dt>
            <dd className="text-right">
              {state.started.verified ? 'Verified' : 'Self-declared'}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Request id</dt>
            <dd className="break-all text-right font-mono text-xs">
              {state.started.authReqId}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Poll every</dt>
            <dd className="text-right tabular-nums">{state.started.interval}s</dd>
          </div>
        </dl>

        {!state.started.verified && (
          <p className="mt-5 border-t border-rule pt-5 text-xs leading-relaxed text-muted">
            This agent did not prove its identity with Web Bot Auth, so even if
            the account holder approves, it will only be able to read the
            account — never place an order.
          </p>
        )}
      </div>
    );
  }

  return (
    <form action={formAction} className="rounded-lg border border-rule bg-surface p-7">
      <Field
        label="Account email"
        name="email"
        type="email"
        required
        placeholder="the customer's email address"
        hint="We send the approval request here. The customer approves on their own device."
      />

      {state.error && <p className="mt-3 text-sm text-ember">{state.error}</p>}

      <div className="mt-7 border-t border-rule pt-6">
        <div className="text-[10px] font-semibold uppercase tracking-[0.13em] text-muted">
          Which agent are you?
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          {platforms.map((platform) => (
            <Button
              key={platform.key}
              type="submit"
              name="platform"
              value={platform.key}
              variant="ghost"
              disabled={pending}
            >
              {platform.displayName}
            </Button>
          ))}
          <Button type="submit" name="platform" value="" variant="secondary" disabled={pending}>
            {pending ? 'Requesting…' : 'Something else'}
          </Button>
        </div>
        <p className="mt-4 text-xs leading-relaxed text-muted">
          Picking a name here is a claim, not proof. It tells the customer who is
          asking; it does not grant permission to buy anything. Agents that sign
          their requests with Web Bot Auth are verified automatically and can be
          granted a spending limit.
        </p>
      </div>
    </form>
  );
}
