'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireCustomer } from '@/lib/auth/session-cookie';
import { requireOrderApproval } from '@/lib/agentSession/stepUp';
import { placeOrder } from '@/lib/services/orders';
import { PriceChangedError, ServiceError } from '@/lib/services/errors';

export type CheckoutState = { error?: string };

export async function placeOrderAction(
  _previous: CheckoutState,
  formData: FormData,
): Promise<CheckoutState> {
  const customer = await requireCustomer();
  const needsApproval = await requireOrderApproval(customer);
  if (needsApproval) return needsApproval;

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
