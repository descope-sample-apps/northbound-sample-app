import { notFound } from 'next/navigation';
import { ButtonLink } from '@/components/brand/Button';
import { Price } from '@/components/brand/Price';
import { requireCustomer } from '@/lib/auth/session-cookie';
import { getOrder } from '@/lib/services/orders';
import { NotFoundError } from '@/lib/services/errors';

const dateFormat = new Intl.DateTimeFormat('en-US', {
  year: 'numeric', month: 'long', day: 'numeric',
});

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ orderNumber: string }>;
}) {
  const customer = await requireCustomer();
  const { orderNumber } = await params;

  let order;
  try {
    // Number('abc') is NaN and Number('') is 0; the service rejects both, so a
    // junk URL renders a 404 page rather than a database error.
    order = await getOrder(customer.id, Number(orderNumber));
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="display text-3xl tabular-nums">Order #{order.orderNumber}</h1>
        <span className="text-sm text-muted">
          {dateFormat.format(order.placedAt)} · {order.status}
        </span>
      </div>

      <section className="mt-8 rounded-lg border border-rule bg-surface p-6">
        <ul className="divide-y divide-rule">
          {order.items.map((item) => (
            <li key={item.id} className="flex justify-between gap-4 py-3 text-sm">
              <span>
                {item.quantity} × {item.nameSnapshot}
                <span className="block text-xs text-muted">
                  <Price cents={item.unitPriceCents} /> each
                </span>
              </span>
              <Price cents={item.lineTotalCents} />
            </li>
          ))}
        </ul>

        <dl className="mt-4 space-y-2 border-t border-rule pt-4 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted">Subtotal</dt>
            <dd><Price cents={order.subtotalCents} /></dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">Shipping</dt>
            <dd>
              {order.shippingCents === 0 ? 'Free' : <Price cents={order.shippingCents} />}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">Tax</dt>
            <dd><Price cents={order.taxCents} /></dd>
          </div>
          <div className="flex justify-between border-t border-rule pt-2 text-base font-medium">
            <dt>Total</dt>
            <dd><Price cents={order.totalCents} /></dd>
          </div>
        </dl>
      </section>

      <section className="mt-8 grid gap-8 sm:grid-cols-2">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.13em] text-muted">
            Shipped to
          </div>
          <address className="mt-2 text-sm not-italic leading-relaxed">
            {order.address.recipient}<br />
            {order.address.line1}
            {order.address.line2 ? `, ${order.address.line2}` : ''}<br />
            {order.address.city}, {order.address.region} {order.address.postalCode}
          </address>
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.13em] text-muted">
            Paid with
          </div>
          <p className="mt-2 text-sm capitalize">
            {order.paymentMethod.brand} ···· {order.paymentMethod.last4}
          </p>
        </div>
      </section>

      <div className="mt-10 border-t border-rule pt-6">
        <ButtonLink href="/orders" variant="secondary">All orders</ButtonLink>
      </div>
    </main>
  );
}
