import Link from 'next/link';
import { ButtonLink } from '@/components/brand/Button';
import { Price } from '@/components/brand/Price';
import { requireCustomer } from '@/lib/auth/session-cookie';
import { listOrders } from '@/lib/services/orders';
import { browserContext } from '@/lib/oauth/types';

const STATUS_STYLE: Record<string, string> = {
  placed: 'bg-spruce/10 text-spruce',
  shipped: 'bg-ember/10 text-ember',
  delivered: 'bg-ink/8 text-muted',
  cancelled: 'bg-ink/8 text-muted',
};

const dateFormat = new Intl.DateTimeFormat('en-US', {
  year: 'numeric', month: 'short', day: 'numeric',
});

export default async function OrdersPage() {
  const customer = await requireCustomer();
  const orders = await listOrders(browserContext(customer.id));

  if (orders.length === 0) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-24 text-center">
        <h1 className="display text-3xl">No orders yet</h1>
        <p className="mt-3 text-muted">When you buy something it will show up here.</p>
        <div className="mt-8 flex justify-center">
          <ButtonLink href="/shop">Shop all gear</ButtonLink>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <h1 className="display text-3xl">Your orders</h1>
      <p className="mt-2 text-sm text-muted">
        {orders.length} {orders.length === 1 ? 'order' : 'orders'}
      </p>

      <ul className="mt-8 divide-y divide-rule border-y border-rule">
        {orders.map((order) => (
          <li key={order.id} className="flex flex-wrap items-center gap-x-6 gap-y-2 py-5">
            <div className="min-w-[7rem]">
              <Link
                href={`/orders/${order.orderNumber}`}
                className="display text-[15px] tabular-nums hover:text-spruce"
              >
                #{order.orderNumber}
              </Link>
              <div className="text-xs text-muted">{dateFormat.format(order.placedAt)}</div>
            </div>

            <span
              className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] ${
                STATUS_STYLE[order.status] ?? STATUS_STYLE.delivered
              }`}
            >
              {order.status}
            </span>

            <span className="text-sm text-muted">
              {order.itemCount} {order.itemCount === 1 ? 'item' : 'items'}
            </span>

            <Price cents={order.totalCents} className="ml-auto text-sm font-medium" />

            <Link
              href={`/orders/${order.orderNumber}`}
              className="relative pb-[3px] text-[10px] font-semibold uppercase tracking-[0.13em] text-ember after:absolute after:bottom-0 after:left-0 after:h-px after:w-[16px] after:bg-ember after:transition-[width] after:duration-300 hover:after:w-full"
            >
              View order
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
