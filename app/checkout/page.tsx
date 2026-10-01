import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CheckoutForm } from '@/components/brand/CheckoutForm';
import { OrderSummary } from '@/components/brand/OrderSummary';
import { requireCustomer } from '@/lib/auth/session-cookie';
import { getCart } from '@/lib/services/cart';
import { listAddresses } from '@/lib/services/addresses';
import { listPaymentMethods } from '@/lib/services/paymentMethods';
import { browserContext } from '@/lib/oauth/types';

export default async function CheckoutPage() {
  const customer = await requireCustomer();

  const [cart, addresses, paymentMethods] = await Promise.all([
    getCart(browserContext(customer.id)),
    listAddresses(browserContext(customer.id)),
    listPaymentMethods(browserContext(customer.id)),
  ]);

  if (cart.items.length === 0) redirect('/cart');

  if (addresses.length === 0 || paymentMethods.length === 0) {
    return (
      <main className="mx-auto max-w-md px-6 py-24 text-center">
        <h1 className="display text-2xl">Almost there</h1>
        <p className="mt-3 text-muted">
          Add {addresses.length === 0 ? 'a shipping address' : 'a payment method'} before
          checking out.
        </p>
        <Link
          href={addresses.length === 0 ? '/account/addresses' : '/account/payment-methods'}
          className="mt-6 inline-block text-[11px] font-semibold uppercase tracking-[0.13em] text-ember hover:underline"
        >
          Go to account
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <h1 className="display text-3xl">Checkout</h1>

      <div className="mt-8">
        <CheckoutForm
          addresses={addresses}
          paymentMethods={paymentMethods}
          expectedTotalCents={cart.totalCents}
          summary={
            <OrderSummary
              subtotalCents={cart.subtotalCents}
              shippingCents={cart.shippingCents}
              taxCents={cart.taxCents}
              totalCents={cart.totalCents}
            >
              <ul className="space-y-1.5 border-t border-rule pt-4 text-sm text-muted">
                {cart.items.map((line) => (
                  <li key={line.productId} className="flex justify-between gap-3">
                    <span className="min-w-0 truncate">
                      {line.quantity} × {line.name}
                    </span>
                  </li>
                ))}
              </ul>
            </OrderSummary>
          }
        />
      </div>
    </main>
  );
}
