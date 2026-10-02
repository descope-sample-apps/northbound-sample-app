'use client';

import { useActionState } from 'react';
import { Button } from './Button';
import { revokeAgentAction, type RevokeState } from '@/app/account/activity/actions';

export function RevokeAgent({
  agentId, displayName,
}: { agentId: string; displayName: string }) {
  const [state, formAction, pending] = useActionState<RevokeState, FormData>(
    revokeAgentAction,
    {},
  );

  if (state.revoked !== undefined) {
    return (
      <p className="text-xs text-spruce">
        Revoked. {state.revoked === 0
          ? 'It held nothing live.'
          : `${state.revoked} token${state.revoked === 1 ? '' : 's'} stopped working.`}
      </p>
    );
  }

  return (
    <form action={formAction}>
      <input type="hidden" name="agentId" value={agentId} />
      <input type="hidden" name="displayName" value={displayName} />
      <Button type="submit" variant="ghost" disabled={pending}>
        {pending ? 'Revoking…' : 'Revoke access'}
      </Button>
      {state.error && <p className="mt-2 text-xs text-ember">{state.error}</p>}
    </form>
  );
}
