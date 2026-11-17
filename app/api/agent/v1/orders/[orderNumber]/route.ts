import { withAgent, jsonResponse, publicOrigin } from '@/lib/api/bearer';
import { orderDetailShape } from '@/lib/api/shapes';
import { getOrder } from '@/lib/services/orders';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ orderNumber: string }> };

/**
 * One order, with its items, where it is going and which card paid for it.
 *
 * getOrder scopes the lookup by customer and answers NOT FOUND — never FORBIDDEN — for an
 * order belonging to somebody else, because a 403 would confirm that order exists. A
 * non-numeric order number lands on the same 404 for the same reason.
 */
export const GET = withAgent<Context>('read', async (request, session, { params }) => {
  const { orderNumber } = await params;

  const order = await getOrder(session.customer.id, Number(orderNumber));

  return jsonResponse({
    acting_for: session.email,
    actor: session.agent,
    order: orderDetailShape(order, publicOrigin(request)),
  });
});
