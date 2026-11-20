import { jsonResponse, publicOrigin } from '@/lib/api/bearer';
import { withCustomer } from '@/lib/api/appBearer';
import { orderDetailShape } from '@/lib/api/shapes';
import { getOrder } from '@/lib/services/orders';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ orderNumber: string }> };

export const GET = withCustomer<Context>(async (request, session, { params }) => {
  const { orderNumber } = await params;
  // getOrder rejects NaN and another customer's number alike as not found.
  const order = await getOrder(session.customer.id, Number(orderNumber));
  return jsonResponse({ order: orderDetailShape(order, publicOrigin(request)) });
});
