'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getAgentSession, requireCustomer } from '@/lib/auth/session-cookie';
import { getCart } from '@/lib/services/cart';
import { placeOrder } from '@/lib/services/orders';
import { PriceChangedError, ServiceError } from '@/lib/services/errors';

export type CheckoutState = { error?: string };

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export async function placeOrderAction(
  _previous: CheckoutState,
  formData: FormData,
): Promise<CheckoutState> {
  const customer = await requireCustomer();

  // An agent may only spend what the customer approved for it. Checked against the cart's
  // real total, not the one the form sends.
  const agentSession = await getAgentSession();
  if (agentSession) {
    const limit = agentSession.purchaseLimitCents;
    if (limit === null) {
      return { error: "This AI agent isn't allowed to place orders. Ask the customer to place this order themselves." };
    }
    const { totalCents } = await getCart(customer.id);
    if (totalCents > limit) {
      return {
        error: `This order (${dollars(totalCents)}) is over the ${dollars(limit)} limit the customer approved for this AI agent. `
          + 'Ask the customer to place it themselves or approve a higher limit.',
      };
    }
  }

  let orderNumber: number;

  try {
    const order = await placeOrder(customer.id, {
      addressId: Number(formData.get('addressId')),
      paymentMethodId: Number(formData.get('paymentMethodId')),
      // The total the customer was actually shown. placeOrder refuses to charge
      // anything else — a price that moved while they were on this page is a
      // question for them, not a surprise on their card.
      expectedTotalCents: Number(formData.get('expectedTotalCents')),
    });
    orderNumber = order.orderNumber;
  } catch (error) {
    if (error instanceof PriceChangedError) {
      revalidatePath('/checkout');
      return {
        error: 'Prices in your cart changed. Review the updated total and try again.',
      };
    }
    if (error instanceof ServiceError) return { error: error.message };
    throw error;
  }

  revalidatePath('/cart');
  revalidatePath('/orders');
  redirect(`/checkout/confirmation/${orderNumber}`);
}
