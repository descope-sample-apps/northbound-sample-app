import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as appSchema from '@/db/schema';

describe('schema', () => {
  it('exports every application table', () => {
    for (const table of [
      'customers', 'sessions', 'categories', 'products', 'carts',
      'cartItems', 'orders', 'orderItems', 'addresses', 'paymentMethods',
    ]) {
      expect(appSchema, table).toHaveProperty(table);
    }
  });

  // The legacy credential store simulates a system Northbound does not own.
  // Re-exporting it from the app schema would make it reachable by ordinary
  // application code, which is exactly what the HTTP boundary exists to prevent.
  it('does NOT re-export the legacy credentials table from the app schema', () => {
    expect(appSchema).not.toHaveProperty('legacyCredentials');
  });

  it('has no column on payment_methods that could hold a full card number', () => {
    // Strip comments first: the security note above the table names the very
    // fields it forbids, and a guard that matched prose would be asserting on
    // the documentation instead of the columns.
    const code = readFileSync('db/schema/account.ts', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/card_?number|\bpan\b|full_?number|cvv|cvc|security_?code/i);
  });

  it('gives orders a unique order_number distinct from the primary key', () => {
    const src = readFileSync('db/schema/commerce.ts', 'utf8');
    expect(src).toMatch(/orderNumber[\s\S]{0,120}\.unique\(\)/);
  });

  it('allows a null password hash so legacy-backed customers can exist', () => {
    const src = readFileSync('db/schema/customers.ts', 'utf8');
    // passwordHash must NOT be notNull — Bob has no local credential at all.
    expect(src).toMatch(/passwordHash:\s*text\('password_hash'\)(?!\s*\.notNull)/);
  });
});
