import { cache } from 'react';
import { cookies } from 'next/headers';
import { getCurrentCustomer } from '@/lib/auth/session-cookie';
import type { CartOwner } from '@/lib/services/cart';

/** Names the browser a guest cart belongs to. Carries no identity of its own. */
export const CART_COOKIE = 'nb_cart';

const CART_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Who the cart in front of this request belongs to.
 *
 * There are two readers because Next.js only lets a cookie be written from a
 * server action or route handler, never while rendering. So rendering reads
 * whatever is already there, and the first write — adding something — is what
 * mints the token.
 *
 * A signed-in customer always wins: their cart follows the account, not the
 * browser, and a stale guest cookie must not shadow it.
 */
export const readCartOwner = cache(async (): Promise<CartOwner | null> => {
  const customer = await getCurrentCustomer();
  if (customer) return { customerId: customer.id };

  const token = (await cookies()).get(CART_COOKIE)?.value;
  return token ? { token } : null;
});

/**
 * The same, for a server action that is about to write. A visitor with no cart
 * yet gets a token here, which is the first moment a row is worth creating.
 */
export async function requireCartOwner(): Promise<CartOwner> {
  const customer = await getCurrentCustomer();
  if (customer) return { customerId: customer.id };

  const jar = await cookies();
  const existing = jar.get(CART_COOKIE)?.value;
  if (existing) return { token: existing };

  const token = crypto.randomUUID();
  jar.set(CART_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: CART_TTL_MS / 1000,
  });

  return { token };
}

/**
 * Moves whatever is in the browser's guest cart onto the account that just signed
 * in, and forgets the cookie either way.
 *
 * Swallows its own failure on purpose. Someone signing in has already proved who
 * they are; refusing them the session because a cart could not be merged would
 * be the wrong trade, and the cart is recoverable while the sign-in is not.
 */
export async function handOverGuestCart(customerId: number): Promise<void> {
  const jar = await cookies();
  const token = jar.get(CART_COOKIE)?.value;
  if (!token) return;

  try {
    const { adoptGuestCart } = await import('@/lib/services/cart');
    await adoptGuestCart(token, customerId);
  } catch (error) {
    console.warn(JSON.stringify({ event: 'guest_cart_handover_failed', reason: String(error) }));
  }

  jar.delete(CART_COOKIE);
}
