import { withAgent, jsonResponse } from '@/lib/api/bearer';
import { addressShape, paymentMethodShape } from '@/lib/api/shapes';
import { listAddresses } from '@/lib/services/addresses';
import { listPaymentMethods } from '@/lib/services/paymentMethods';

export const dynamic = 'force-dynamic';

/**
 * The saved addresses and cards an order may be placed against.
 *
 * READ ONLY, AND THERE IS NO WRITE COUNTERPART. An assistant can see which address an
 * order would ship to and which card would be charged — enough to tell the customer
 * before it spends their money, and enough to pass a non-default id to POST /orders. It
 * cannot add, edit or delete any of them: lib/agentSession/accountChanges.ts refuses
 * account changes to assistants outright, because Northbound issues no scope for them,
 * and Agent Edge blocks the payment pages at the edge as well.
 *
 * Cards are brand, last four and expiry. The table holds nothing else to send.
 */
export const GET = withAgent('read', async (_request, session) => {
  const customerId = session.customer.id;
  const [addresses, paymentMethods] = await Promise.all([
    listAddresses(customerId),
    listPaymentMethods(customerId),
  ]);

  return jsonResponse({
    acting_for: session.email,
    actor: session.agent,
    // What POST /orders uses when address_id or payment_method_id is left out.
    addresses: addresses.map(addressShape),
    payment_methods: paymentMethods.map(paymentMethodShape),
  });
});
