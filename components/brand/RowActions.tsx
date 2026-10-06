'use client';

import { useActionState } from 'react';
import type { AccountState } from '@/app/account/actions';

type RowAction = (previous: AccountState, formData: FormData) => Promise<AccountState>;

/**
 * A one-button form that renders its own failure.
 *
 * Deleting an address or card a past order references is refused by the service
 * with a readable reason. Without useActionState here that reason went nowhere:
 * the row simply did not disappear and the customer was left guessing.
 */
export function RowActionButton({
  action,
  id,
  label,
  pendingLabel,
  tone = 'muted',
}: {
  action: RowAction;
  id: number;
  label: string;
  pendingLabel: string;
  tone?: 'muted' | 'ember';
}) {
  const [state, formAction, pending] = useActionState<AccountState, FormData>(action, {});

  return (
    <div>
      <form action={formAction}>
        <input type="hidden" name="id" value={id} />
        <button
          type="submit"
          disabled={pending}
          className={`text-[10px] font-semibold uppercase tracking-[0.13em] disabled:opacity-50 ${
            tone === 'ember' ? 'text-ember hover:underline' : 'text-muted hover:text-spruce'
          }`}
        >
          {pending ? pendingLabel : label}
        </button>
      </form>

      {state.error && (
        <p role="alert" className="mt-2 max-w-[34ch] text-xs leading-relaxed text-ember">
          {state.error}
        </p>
      )}
    </div>
  );
}
