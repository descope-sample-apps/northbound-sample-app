import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function sourceFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.tsx?$/.test(path)) out.push(path);
  }
  return out;
}

/**
 * Everything under these needs someone signed in — a customer here themselves, or an
 * AI assistant admitted for them. requireCustomer() resolves either and redirects to
 * /login when it is neither, so it is the single gate.
 *
 * This is a structural rule rather than a page-by-page test on purpose: the risk is
 * not that today's /orders stops checking, it is that tomorrow's /orders/invoices
 * never starts. A rule over the directory catches the page nobody wrote yet.
 */
const PROTECTED_ROOTS = ['account', 'cart', 'checkout', 'orders'];

/** Browsing the catalogue requires no one. Gating these would be a different store. */
const PUBLIC_PAGES = [
  join('app', 'page.tsx'),
  join('app', 'product', '[slug]', 'page.tsx'),
  join('app', 'shop', 'page.tsx'),
  join('app', 'shop', '[category]', 'page.tsx'),
];

describe('pages that need someone signed in', () => {
  it('gates every page under the protected roots', () => {
    const ungated = PROTECTED_ROOTS
      .flatMap((root) => sourceFiles(join('app', root)))
      .filter((file) => /page\.tsx$/.test(file))
      .filter((file) => !readFileSync(file, 'utf8').includes('requireCustomer('));

    expect(ungated).toEqual([]);
  });

  it('gates the server actions under them too', () => {
    // A page that redirects is not a boundary: the action it posts to is reachable
    // on its own, so the check has to be there as well.
    const ungated = PROTECTED_ROOTS
      .flatMap((root) => sourceFiles(join('app', root)))
      .filter((file) => /actions\.tsx?$/.test(file))
      .filter((file) => !readFileSync(file, 'utf8').includes('requireCustomer('));

    expect(ungated).toEqual([]);
  });

  it('covers the pages that exist today', () => {
    const pages = PROTECTED_ROOTS
      .flatMap((root) => sourceFiles(join('app', root)))
      .filter((file) => /page\.tsx$/.test(file))
      .sort();

    // If this list shrinks, a protected page was deleted or moved out of the roots
    // above, and the rule quietly stopped covering it.
    expect(pages).toEqual([
      join('app', 'account', 'addresses', 'page.tsx'),
      join('app', 'account', 'page.tsx'),
      join('app', 'account', 'payment-methods', 'page.tsx'),
      join('app', 'cart', 'page.tsx'),
      join('app', 'checkout', 'confirmation', '[orderNumber]', 'page.tsx'),
      join('app', 'checkout', 'page.tsx'),
      join('app', 'orders', '[orderNumber]', 'page.tsx'),
      join('app', 'orders', 'page.tsx'),
    ].sort());
  });

  it('leaves the catalogue open', () => {
    const gated = PUBLIC_PAGES.filter((file) => readFileSync(file, 'utf8').includes('requireCustomer('));
    expect(gated).toEqual([]);
  });
});
