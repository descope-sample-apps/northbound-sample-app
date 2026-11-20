import { withAgent, jsonResponse, publicOrigin } from '@/lib/api/bearer';
import { cartShape } from '@/lib/api/shapes';
import { getCart } from '@/lib/services/cart';

export const dynamic = 'force-dynamic';

/**
 * The customer's cart, with the total an order placed right now would charge.
 *
 * The same cart the customer sees on /cart — one cart per customer, not a second one for
 * assistants. An assistant adding something is adding it to the customer's cart, and the
 * customer finds it there when they next look, which is the honest behaviour: a hidden
 * agent-only cart would let an assistant stage a purchase the customer could not inspect.
 *
 * total_cents here is what POST /orders should be given as expected_total_cents.
 */
export const GET = withAgent('read', async (request, session) => {
  const cart = await getCart({ customerId: session.customer.id });

  return jsonResponse({
    acting_for: session.email,
    actor: session.agent,
    cart: cartShape(cart, publicOrigin(request)),
  });
});
