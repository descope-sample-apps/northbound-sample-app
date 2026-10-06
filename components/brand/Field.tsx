import type { ComponentProps, ReactNode } from 'react';

export function Field({
  label,
  name,
  error,
  hint,
  children,
  ...rest
}: {
  label: string;
  name: string;
  error?: string;
  hint?: ReactNode;
  children?: ReactNode;
} & Omit<ComponentProps<'input'>, 'name'>) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.13em] text-muted">
        {label}
      </span>

      {children ?? (
        <input
          name={name}
          aria-invalid={error ? true : undefined}
          className={`w-full rounded-[3px] border bg-surface px-3 py-2.5 text-[15px] outline-none transition-colors focus:border-spruce ${
            error ? 'border-ember' : 'border-rule'
          }`}
          {...rest}
        />
      )}

      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-ember">{error}</span>}
    </label>
  );
}
