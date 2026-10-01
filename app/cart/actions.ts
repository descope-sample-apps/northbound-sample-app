'use server';

import { revalidatePath } from 'next/cache';
import { requireCustomer } from '@/lib/auth/session-cookie';
import { removeFromCart, updateCartItem } from '@/lib/services/cart';
import { ServiceError } from '@/lib/services/errors';
import { browserContext } from '@/lib/oauth/types';

export type CartActionState = { error?: string };

export async function updateQuantityAction(
  _previous: CartActionState,
  formData: FormData,
): Promise<CartActionState> {
  const customer = await requireCustomer();
  const productId = Number(formData.get('productId'));
  const quantity = Number(formData.get('quantity'));

  try {
    await updateCartItem(browserContext(customer.id), productId, quantity);
  } catch (error) {
    if (error instanceof ServiceError) return { error: error.message };
    throw error;
  }

  revalidatePath('/cart');
  revalidatePath('/checkout');
  return {};
}

export async function removeItemAction(
  _previous: CartActionState,
  formData: FormData,
): Promise<CartActionState> {
  const customer = await requireCustomer();

  try {
    await removeFromCart(browserContext(customer.id), Number(formData.get('productId')));
  } catch (error) {
    if (error instanceof ServiceError) return { error: error.message };
    throw error;
  }

  revalidatePath('/cart');
  revalidatePath('/checkout');
  return {};
}
