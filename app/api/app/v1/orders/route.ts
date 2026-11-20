import { jsonResponse, publicOrigin } from '@/lib/api/bearer';
import { withCustomer } from '@/lib/api/appBearer';
import { orderSummaryShape } from '@/lib/api/shapes';
import { listOrders } from '@/lib/services/orders';

export const dynamic = 'force-dynamic';

export const GET = withCustomer(async (request, session) => {
  const orders = await listOrders(session.customer.id);
  const origin = publicOrigin(request);
  return jsonResponse({ orders: orders.map((order) => orderSummaryShape(order, origin)) });
});
