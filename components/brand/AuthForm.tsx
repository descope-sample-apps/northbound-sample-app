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
  hidden,
}: {
  action: (previous: State, formData: FormData) => Promise<State>;
  submitLabel: string;
  pendingLabel: string;
  mode: 'login' | 'signup';
  /** Extra fields carried through the form unchanged. */
  hidden?: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState<State, FormData>(action, {});

  return (
    <form action={formAction} className="space-y-5">
      {hidden && Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
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
