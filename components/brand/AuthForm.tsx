'use client';

import { useActionState } from 'react';
import { Button } from './Button';
import { Field } from './Field';

type State = { error?: string };

export function AuthForm({
  action,
  submitLabel,
  pendingLabel,
  mode,
  next,
}: {
  action: (previous: State, formData: FormData) => Promise<State>;
  submitLabel: string;
  pendingLabel: string;
  mode: 'login' | 'signup';
  /** Where to land after signing in. Validated server-side, never trusted here. */
  next?: string;
}) {
  const [state, formAction, pending] = useActionState<State, FormData>(action, {});

  return (
    <form action={formAction} className="space-y-5">
      {next && <input type="hidden" name="next" value={next} />}
      {mode === 'signup' && (
        <Field label="Name" name="name" type="text" autoComplete="name" required />
      )}

      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        required
      />

      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
        required
        hint={mode === 'signup' ? 'At least 10 characters.' : undefined}
      />

      {state.error && (
        <p role="alert" className="text-sm text-ember">
          {state.error}
        </p>
      )}

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? pendingLabel : submitLabel}
      </Button>
    </form>
  );
}
