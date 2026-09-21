'use client';

import { useActionState } from 'react';
import { Button } from './Button';
import { addToCartAction, type ActionState } from '@/app/product/[slug]/actions';

/**
 * Motion is restricted to cart updates, per the brand system. The confirmation
 * line fading in is the whole of it — nothing else on this page animates.
 */
export function AddToCartForm({
  productId,
  slug,
  stockQty,
}: {
  productId: number;
  slug: string;
  stockQty: number;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    addToCartAction,
    {},
  );

  if (stockQty <= 0) {
    return (
      <div className="mt-8">
        <Button disabled>Out of stock</Button>
        <p className="mt-2 text-sm text-muted">
          We will restock this. There is no waitlist yet.
        </p>
      </div>
    );
  }

  const maxSelectable = Math.min(stockQty, 10);

  return (
    <form action={formAction} className="mt-8">
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="slug" value={slug} />

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-[10px] font-semibold uppercase tracking-[0.13em] text-muted">
            Qty
          </span>
          <select
            name="quantity"
            defaultValue="1"
            className="rounded-[3px] border border-rule bg-surface px-3 py-2.5 text-[15px] outline-none focus:border-spruce"
          >
            {Array.from({ length: maxSelectable }, (_, index) => index + 1).map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>

        <Button type="submit" disabled={pending}>
          {pending ? 'Adding…' : 'Add to cart'}
        </Button>
      </div>

      {state.error && <p className="mt-3 text-sm text-ember">{state.error}</p>}
      {state.added && (
        <p className="mt-3 text-sm text-spruce transition-opacity duration-200">
          Added to your cart.
        </p>
      )}

      {stockQty <= 3 && (
        <p className="mt-3 text-sm text-muted">Only {stockQty} left.</p>
      )}
    </form>
  );
}
