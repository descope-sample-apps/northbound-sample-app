import { Price } from './Price';
import { FREE_SHIPPING_THRESHOLD_CENTS, formatCents } from '@/lib/money';

export function OrderSummary({
  subtotalCents,
  shippingCents,
  taxCents,
  totalCents,
  children,
}: {
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  children?: React.ReactNode;
}) {
  const shortfall = FREE_SHIPPING_THRESHOLD_CENTS - subtotalCents;

  return (
    // Motion is restricted to cart updates: the totals fade rather than jump
    // when a quantity changes. Nothing else on the page animates.
    <aside className="rounded-lg border border-rule bg-surface p-6 transition-opacity duration-200">
      <h2 className="display text-lg">Summary</h2>

      <dl className="mt-4 space-y-2.5 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted">Subtotal</dt>
          <dd><Price cents={subtotalCents} /></dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted">Shipping</dt>
          <dd>{shippingCents === 0 ? 'Free' : <Price cents={shippingCents} />}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted">Tax</dt>
          <dd><Price cents={taxCents} /></dd>
        </div>
        <div className="flex justify-between border-t border-rule pt-3 text-base font-medium">
          <dt>Total</dt>
          <dd><Price cents={totalCents} /></dd>
        </div>
      </dl>

      {shortfall > 0 && subtotalCents > 0 && (
        <p className="mt-4 text-xs text-muted">
          {formatCents(shortfall)} more for free shipping.
        </p>
      )}

      {children && <div className="mt-6">{children}</div>}
    </aside>
  );
}
