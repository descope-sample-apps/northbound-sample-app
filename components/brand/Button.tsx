import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

const base =
  'inline-flex items-center justify-center font-sans transition-all duration-200 ' +
  'cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';

/**
 * Three roles, not two.
 *
 * `secondary` is an editorial rule — a text treatment with a underline that
 * draws out on hover. It reads well next to a filled button and terribly
 * opposite one, which is why `ghost` exists separately.
 */
const variants = {
  /** The main action on a surface. Sharp 3px radius echoes the nav's 2px rule. */
  primary:
    'bg-spruce text-paper rounded-[3px] px-5 py-3 text-[11px] font-semibold ' +
    'uppercase tracking-[0.11em] hover:bg-spruce-deep',

  /** Browsing, and navigation away from the current surface. */
  secondary:
    'relative bg-transparent px-0 pb-[5px] text-[11px] font-semibold uppercase ' +
    'tracking-[0.13em] text-ember after:absolute after:left-0 after:bottom-0 ' +
    "after:h-px after:w-[22px] after:bg-ember after:content-[''] " +
    'after:transition-[width] after:duration-300 hover:after:w-full',

  /**
   * DECISION PAIRS ONLY — consent screens, approval prompts, destructive
   * confirmations. Sized to match `primary` so an Approve/Deny pair reads as
   * two real buttons rather than a button and a link.
   *
   * Unused in the storefront. It is defined here, as part of one coherent
   * system, so sub-project C's consent screen does not have to invent a button
   * style under deadline.
   */
  ghost:
    'border border-spruce bg-transparent text-spruce rounded-[3px] px-5 py-3 ' +
    'text-[11px] font-semibold uppercase tracking-[0.11em] ' +
    'hover:bg-spruce hover:text-paper',
} as const;

export type ButtonVariant = keyof typeof variants;

export function Button({
  variant = 'primary',
  className = '',
  children,
  ...rest
}: { variant?: ButtonVariant; children: ReactNode } & ComponentProps<'button'>) {
  return (
    <button className={`${base} ${variants[variant]} ${className}`} {...rest}>
      {children}
    </button>
  );
}

export function ButtonLink({
  variant = 'primary',
  className = '',
  children,
  href,
}: {
  variant?: ButtonVariant;
  children: ReactNode;
  href: string;
  className?: string;
}) {
  return (
    <Link href={href} className={`${base} ${variants[variant]} ${className}`}>
      {children}
    </Link>
  );
}
