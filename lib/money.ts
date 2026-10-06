export const TAX_RATE_BPS = 850; // 8.5%, in basis points
export const FREE_SHIPPING_THRESHOLD_CENTS = 7500; // $75.00
export const FLAT_SHIPPING_CENTS = 895; // $8.95

export type Totals = {
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
};

/**
 * Evaluated in a fixed order, because "shipping is free over $75" is ambiguous
 * about which figure it tests:
 *
 *   1. shipping keys off SUBTOTAL
 *   2. tax is a percentage of SUBTOTAL ONLY — shipping is not taxed
 *   3. total is the sum
 *
 * Sub-project D's policy engine and the Rich Authorization Request
 * `maximum_amount` ceiling both compare against `totalCents` — what the
 * customer is actually charged. Changing that here means changing it in both.
 */
export function calcTotals(subtotalCents: number): Totals {
  const shippingCents =
    subtotalCents >= FREE_SHIPPING_THRESHOLD_CENTS ? 0 : FLAT_SHIPPING_CENTS;
  const taxCents = Math.round((subtotalCents * TAX_RATE_BPS) / 10_000);

  return {
    subtotalCents,
    shippingCents,
    taxCents,
    totalCents: subtotalCents + shippingCents + taxCents,
  };
}

export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
