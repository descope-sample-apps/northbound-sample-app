import Link from 'next/link';
import { getCurrentCustomer } from '@/lib/auth/session-cookie';
import { getCart } from '@/lib/services/cart';
import { logoutAction } from '@/app/login/actions';

const LINKS = [
  ['/shop', 'Shop'],
  ['/orders', 'Orders'],
  ['/account', 'Account'],
] as const;

const linkClass =
  'text-[11px] font-medium uppercase tracking-[0.11em] text-ink hover:text-spruce ' +
  'whitespace-nowrap transition-colors';

/**
 * Direction B's structure in direction A's palette: uppercase 11px links at
 * 0.11em tracking over a 2px ink rule, with the wordmark in Fraunces spruce.
 * The structure comes from CSS treatment, not from a third typeface.
 */
export async function Nav() {
  const customer = await getCurrentCustomer();
  const cart = customer ? await getCart(customer.id) : null;
  const itemCount = cart?.items.reduce((total, line) => total + line.quantity, 0) ?? 0;

  return (
    <header className="border-b-2 border-ink bg-paper">
      <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-7 gap-y-2 px-6 py-4">
        <Link href="/" className="display mr-auto text-[21px] text-spruce">
          Northbound
        </Link>

        {LINKS.map(([href, label]) => (
          <Link key={href} href={href} className={linkClass}>
            {label}
          </Link>
        ))}

        <Link
          href="/cart"
          className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.11em] text-spruce transition-colors hover:text-spruce-deep"
        >
          Cart ({itemCount})
        </Link>

        {customer ? (
          <form action={logoutAction}>
            <button type="submit" className={linkClass}>
              Sign out
            </button>
          </form>
        ) : (
          <Link href="/login" className={linkClass}>
            Sign in
          </Link>
        )}
      </nav>
    </header>
  );
}
