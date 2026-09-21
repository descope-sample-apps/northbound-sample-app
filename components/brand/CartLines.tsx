'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useActionState } from 'react';
import { Price } from './Price';
import {
  removeItemAction,
  updateQuantityAction,
  type CartActionState,
} from '@/app/cart/actions';
import type { CartLine } from '@/lib/services/cart';

function QuantityForm({ line }: { line: CartLine }) {
  const [state, formAction, pending] = useActionState<CartActionState, FormData>(
    updateQuantityAction,
    {},
  );

  const maxSelectable = Math.max(line.quantity, Math.min(line.stockQty, 10));

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="productId" value={line.productId} />
      <select
        name="quantity"
        defaultValue={String(line.quantity)}
        disabled={pending}
        // Submitting on change keeps this a one-step interaction. The form
        // still works without JavaScript via the Update button below.
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
        className="rounded-[3px] border border-rule bg-surface px-2 py-1.5 text-sm outline-none focus:border-spruce"
      >
        {Array.from({ length: maxSelectable }, (_, index) => index + 1).map((n) => (
          <option key={n} value={n}>{n}</option>
        ))}
      </select>
      <button
        type="submit"
        className="sr-only focus:not-sr-only focus:text-xs focus:underline"
      >
        Update
      </button>
      {state.error && <span className="text-xs text-ember">{state.error}</span>}
    </form>
  );
}

function RemoveForm({ productId }: { productId: number }) {
  const [, formAction, pending] = useActionState<CartActionState, FormData>(
    removeItemAction,
    {},
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="productId" value={productId} />
      <button
        type="submit"
        disabled={pending}
        className="relative pb-[3px] text-[10px] font-semibold uppercase tracking-[0.13em] text-ember after:absolute after:bottom-0 after:left-0 after:h-px after:w-[16px] after:bg-ember after:transition-[width] after:duration-300 hover:after:w-full"
      >
        {pending ? 'Removing…' : 'Remove'}
      </button>
    </form>
  );
}

export function CartLines({ items }: { items: CartLine[] }) {
  return (
    <ul className="divide-y divide-rule border-y border-rule">
      {items.map((line) => (
        <li key={line.productId} className="flex gap-5 py-5">
          <Link href={`/product/${line.slug}`} className="shrink-0">
            <Image
              src={line.imagePath}
              alt={line.name}
              width={160}
              height={120}
              className="h-20 w-[6.5rem] rounded-[5px] object-cover"
            />
          </Link>

          <div className="min-w-0 flex-1">
            <Link href={`/product/${line.slug}`} className="display text-[15px] hover:text-spruce">
              {line.name}
            </Link>
            <div className="mt-0.5 text-sm text-muted">
              <Price cents={line.unitPriceCents} /> each
            </div>

            {!line.isActive && (
              <p className="mt-1 text-xs text-ember">
                No longer available — remove it to check out.
              </p>
            )}
            {line.isActive && line.quantity > line.stockQty && (
              <p className="mt-1 text-xs text-ember">
                Only {line.stockQty} left — reduce the quantity to check out.
              </p>
            )}

            <div className="mt-3 flex items-center gap-5">
              <QuantityForm line={line} />
              <RemoveForm productId={line.productId} />
            </div>
          </div>

          <Price cents={line.lineTotalCents} className="pt-1 text-sm font-medium" />
        </li>
      ))}
    </ul>
  );
}
