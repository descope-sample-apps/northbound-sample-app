'use client';

import { useActionState } from 'react';
import { Button } from './Button';
import { decideAction, type DecisionState } from '@/app/approve/[authReqId]/actions';

export function ApprovalDecision({ authReqId }: { authReqId: string }) {
  const [state, formAction, pending] = useActionState<DecisionState, FormData>(
    decideAction,
    {},
  );

  if (state.decided === 'approved') {
    return (
      <p className="rounded-[5px] bg-spruce/10 px-4 py-3 text-sm text-spruce">
        Approved. The agent can now act within the limits above.
      </p>
    );
  }

  if (state.decided === 'denied') {
    return (
      <p className="rounded-[5px] bg-ember/10 px-4 py-3 text-sm text-ember">
        Declined. The agent received nothing.
      </p>
    );
  }

  return (
    <form action={formAction}>
      <input type="hidden" name="authReqId" value={authReqId} />
      {state.error && <p className="mb-4 text-sm text-ember">{state.error}</p>}

      {/* Approve and Deny as a real pair — the tertiary `ghost` variant exists
          for exactly this, so Deny carries the same weight as Approve. */}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" name="decision" value="approved" disabled={pending}>
          {pending ? 'Saving…' : 'Approve'}
        </Button>
        <Button
          type="submit" name="decision" value="denied"
          variant="ghost" disabled={pending}
        >
          Deny
        </Button>
      </div>
    </form>
  );
}
