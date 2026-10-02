import { withBearer } from '../_lib/withBearer';
import { listOrders } from '@/lib/services/orders';
import { formatCents } from '@/lib/money';

export const GET = withBearer(['orders:read'], async (ctx) => {
  const orders = await listOrders(ctx);

  return Response.json({
    // Echoed so an agent — and anyone reading a trace — can see that this
    // response was produced FOR a customer BY an agent, and that the two are
    // not the same party.
    acting_for: `user_${ctx.customerId}`,
    actor: ctx.actor?.agentId ?? null,
    orders: orders.map((order) => ({
      order_number: order.orderNumber,
      status: order.status,
      placed_at: order.placedAt.toISOString(),
      item_count: order.itemCount,
      total: formatCents(order.totalCents),
      total_cents: order.totalCents,
    })),
  }, { headers: { 'cache-control': 'no-store' } });
});
