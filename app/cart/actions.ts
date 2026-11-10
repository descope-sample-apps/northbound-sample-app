'use server';

import { revalidatePath } from 'next/cache';
import { requireCartOwner } from '@/lib/cart/owner';
import { removeFromCart, updateCartItem } from '@/lib/services/cart';
import { ServiceError } from '@/lib/services/errors';

export type CartActionState = { error?: string };

export async function updateQuantityAction(
  _previous: CartActionState,
  formData: FormData,
): Promise<CartActionState> {
  const owner = await requireCartOwner();
  const productId = Number(formData.get('productId'));
  const quantity = Number(formData.get('quantity'));

  try {
    await updateCartItem(owner, productId, quantity);
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
  const owner = await requireCartOwner();

  try {
    await removeFromCart(owner, Number(formData.get('productId')));
  } catch (error) {
    if (error instanceof ServiceError) return { error: error.message };
    throw error;
  }

  revalidatePath('/cart');
  revalidatePath('/checkout');
  return {};
}
