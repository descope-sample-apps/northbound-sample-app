import { withBearer, serviceErrorResponse } from '../../_lib/withBearer';
import { getOrder } from '@/lib/services/orders';
import { formatCents } from '@/lib/money';

type Params = { params: Promise<{ orderNumber: string }> };

export async function GET(request: Request, context: Params): Promise<Response> {
  const { orderNumber } = await context.params;

  return withBearer(['orders:read'], async (ctx) => {
    try {
      // Scoped by the context's customer, so another customer's order is a 404
      // rather than a readable receipt. The service already guarantees this;
      // the API inherits it rather than re-implementing it.
      const order = await getOrder(ctx, Number(orderNumber));

      return Response.json({
        acting_for: `user_${ctx.customerId}`,
        actor: ctx.actor?.agentId ?? null,
        order_number: order.orderNumber,
        status: order.status,
        placed_at: order.placedAt.toISOString(),
        subtotal: formatCents(order.subtotalCents),
        shipping: formatCents(order.shippingCents),
        tax: formatCents(order.taxCents),
        total: formatCents(order.totalCents),
        total_cents: order.totalCents,
        items: order.items.map((item) => ({
          name: item.nameSnapshot,
          quantity: item.quantity,
          unit_price: formatCents(item.unitPriceCents),
          line_total: formatCents(item.lineTotalCents),
        })),
        ship_to: {
          recipient: order.address.recipient,
          city: order.address.city,
          region: order.address.region,
          postal_code: order.address.postalCode,
        },
      }, { headers: { 'cache-control': 'no-store' } });
    } catch (error) {
      return serviceErrorResponse(error);
    }
  })(request);
}
