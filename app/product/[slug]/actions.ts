'use server';

import { revalidatePath } from 'next/cache';
import { requireCustomer } from '@/lib/auth/session-cookie';
import { addToCart } from '@/lib/services/cart';
import { ServiceError } from '@/lib/services/errors';
import { browserContext } from '@/lib/oauth/types';

export type ActionState = { error?: string; added?: boolean };

/**
 * Translates a ServiceError into something a form can render, and nothing else.
 *
 * Validation deliberately does NOT live here: it lives in the cart service, so
 * that every future caller — the agent API, the MCP server — is checked by the
 * same rules rather than by whatever each surface remembered to do.
 */
export async function addToCartAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const customer = await requireCustomer();

  const productId = Number(formData.get('productId'));
  const quantity = Number(formData.get('quantity') ?? 1);
  const slug = String(formData.get('slug') ?? '');

  try {
    await addToCart(browserContext(customer.id), productId, quantity);
  } catch (error) {
    if (error instanceof ServiceError) return { error: error.message };
    throw error;
  }

  revalidatePath('/cart');
  if (slug) revalidatePath(`/product/${slug}`);
  return { added: true };
}
