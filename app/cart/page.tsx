import { ButtonLink } from '@/components/brand/Button';
import { CartLines } from '@/components/brand/CartLines';
import { OrderSummary } from '@/components/brand/OrderSummary';
import { requireCustomer } from '@/lib/auth/session-cookie';
import { getCart } from '@/lib/services/cart';

export default async function CartPage() {
  const customer = await requireCustomer();
  const cart = await getCart(customer.id);

  if (cart.items.length === 0) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-24 text-center">
        <h1 className="display text-3xl">Your cart is empty</h1>
        <p className="mt-3 text-muted">Nothing in here yet.</p>
        <div className="mt-8 flex justify-center">
          <ButtonLink href="/shop">Shop all gear</ButtonLink>
        </div>
      </main>
    );
  }

  const blocked = cart.items.some(
    (line) => !line.isActive || line.quantity > line.stockQty,
  );

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <h1 className="display text-3xl">Your cart</h1>

      <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_320px]">
        <CartLines items={cart.items} />

        <div className="lg:sticky lg:top-8 lg:self-start">
          <OrderSummary
            subtotalCents={cart.subtotalCents}
            shippingCents={cart.shippingCents}
            taxCents={cart.taxCents}
            totalCents={cart.totalCents}
          >
            {blocked ? (
              <p className="text-sm text-ember">
                Fix the flagged items above before checking out.
              </p>
            ) : (
              <ButtonLink href="/checkout" className="w-full">
                Proceed to checkout
              </ButtonLink>
            )}
          </OrderSummary>

          <div className="mt-6">
            <ButtonLink href="/shop" variant="secondary">Keep shopping</ButtonLink>
          </div>
        </div>
      </div>
    </main>
  );
}
