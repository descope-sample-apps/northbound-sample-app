import { formatCents } from '@/lib/money';

/** Tabular numerals so prices in a column line up at the decimal point. */
export function Price({ cents, className = '' }: { cents: number; className?: string }) {
  return <span className={`tabular-nums ${className}`}>{formatCents(cents)}</span>;
}
