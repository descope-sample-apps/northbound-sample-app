import { describe, it, expect } from 'vitest';
import { calcTotals, formatCents } from '@/lib/money';

describe('calcTotals', () => {
  it('charges flat shipping below the free threshold', () => {
    expect(calcTotals(5000)).toEqual({
      subtotalCents: 5000, shippingCents: 895, taxCents: 425, totalCents: 6320,
    });
  });

  it('gives free shipping at exactly the threshold', () => {
    expect(calcTotals(7500).shippingCents).toBe(0);
  });

  it('does not tax shipping', () => {
    // 8.5% of 5000 is 425. If shipping were taxed it would be 501.
    expect(calcTotals(5000).taxCents).toBe(425);
  });

  it('handles an empty subtotal without inventing tax', () => {
    expect(calcTotals(0)).toEqual({
      subtotalCents: 0, shippingCents: 895, taxCents: 0, totalCents: 895,
    });
  });

  it('rounds tax half-up to the cent', () => {
    // 8.5% of 4206 = 357.51 -> 358
    expect(calcTotals(4206).taxCents).toBe(358);
  });

  it('keeps the total equal to the sum of its parts', () => {
    for (const subtotal of [0, 1, 4206, 7499, 7500, 84000, 90000]) {
      const t = calcTotals(subtotal);
      expect(t.totalCents, `subtotal ${subtotal}`)
        .toBe(t.subtotalCents + t.shippingCents + t.taxCents);
    }
  });
});

describe('formatCents', () => {
  it('formats with two decimals', () => {
    expect(formatCents(42000)).toBe('$420.00');
    expect(formatCents(1805)).toBe('$18.05');
    expect(formatCents(0)).toBe('$0.00');
  });
});
