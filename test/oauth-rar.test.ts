import { describe, it, expect } from 'vitest';
import {
  SCOPES, isScope, parseMoneyValue, parsePeriod, formatMoneyValue,
  isPurchaseDetail,
} from '@/lib/oauth/types';

describe('scopes', () => {
  // The blog writes orders:read and cart:write. Readers will diff the post
  // against this repo, so the separator has to match.
  it('uses colon separators, as the blog does', () => {
    expect(SCOPES).toEqual([
      'products:read', 'orders:read', 'cart:read', 'cart:write',
      'checkout', 'profile:read', 'addresses:write', 'payment_methods:write',
    ]);
  });

  it('rejects the old dotted spellings', () => {
    expect(isScope('orders.read')).toBe(false);
    expect(isScope('orders:read')).toBe(true);
  });
});

describe('parseMoneyValue', () => {
  // The blog's RAR carries "200.00" — a major-unit decimal string. Every
  // comparison downstream is in integer cents, so this is the one place a
  // rounding mistake could let an agent overspend.
  it('converts major-unit decimal strings to cents', () => {
    expect(parseMoneyValue('200.00')).toBe(20_000);
    expect(parseMoneyValue('160.00')).toBe(16_000);
    expect(parseMoneyValue('0.50')).toBe(50);
    expect(parseMoneyValue('0.5')).toBe(50);
    expect(parseMoneyValue('7')).toBe(700);
    expect(parseMoneyValue('1234.56')).toBe(123_456);
  });

  it('does not lose a cent to floating point', () => {
    expect(parseMoneyValue('0.07')).toBe(7);
    expect(parseMoneyValue('1.10')).toBe(110);
    expect(parseMoneyValue('8.15')).toBe(815);
    expect(parseMoneyValue('99.99')).toBe(9_999);
  });

  it('rejects anything that is not a plain positive decimal', () => {
    for (const bad of [
      '', ' ', 'abc', '1e3', '-5.00', '200.123', '.5', '5.', '1,000.00',
      'Infinity', 'NaN', '٠٫٥', '200.00 USD', '+5.00', '0x10',
    ]) {
      expect(() => parseMoneyValue(bad), JSON.stringify(bad)).toThrow();
    }
  });

  it('rejects zero, because a zero cap is a denial and should say so', () => {
    expect(() => parseMoneyValue('0')).toThrow();
    expect(() => parseMoneyValue('0.00')).toThrow();
  });

  it('round-trips through formatMoneyValue', () => {
    for (const value of ['200.00', '0.50', '1234.56']) {
      expect(formatMoneyValue(parseMoneyValue(value))).toBe(value);
    }
  });
});

describe('parsePeriod', () => {
  // period: "P7D" means $200 across seven days, not $200 per order.
  it('parses the ISO 8601 durations the blog and a sane client would send', () => {
    const day = 86_400_000;
    expect(parsePeriod('P7D')).toBe(7 * day);
    expect(parsePeriod('P1D')).toBe(day);
    expect(parsePeriod('P30D')).toBe(30 * day);
    expect(parsePeriod('P1W')).toBe(7 * day);
    expect(parsePeriod('PT1H')).toBe(3_600_000);
    expect(parsePeriod('PT30M')).toBe(1_800_000);
    expect(parsePeriod('P1DT12H')).toBe(day + 12 * 3_600_000);
  });

  it('rejects malformed or unbounded periods', () => {
    for (const bad of ['', 'P', '7 days', '7D', 'PT', 'P0D', 'P-1D', 'PY', 'P1Y']) {
      expect(() => parsePeriod(bad), JSON.stringify(bad)).toThrow();
    }
  });
});

describe('isPurchaseDetail', () => {
  const valid = {
    type: 'purchase',
    max_amount: { value: '200.00', currency: 'USD' },
    merchant: 'northbound.example.com',
    period: 'P7D',
  };

  it('accepts the blog\'s object', () => {
    expect(isPurchaseDetail(valid)).toBe(true);
  });

  it('rejects anything missing or malformed', () => {
    expect(isPurchaseDetail({ ...valid, type: 'checkout' })).toBe(false);
    expect(isPurchaseDetail({ ...valid, max_amount: '200.00' })).toBe(false);
    expect(isPurchaseDetail({ ...valid, max_amount: { value: 200, currency: 'USD' } }))
      .toBe(false);
    expect(isPurchaseDetail({ ...valid, period: '7 days' })).toBe(false);
    expect(isPurchaseDetail({ ...valid, max_amount: { value: 'abc', currency: 'USD' } }))
      .toBe(false);
    expect(isPurchaseDetail(null)).toBe(false);
    expect(isPurchaseDetail({})).toBe(false);
  });
});
