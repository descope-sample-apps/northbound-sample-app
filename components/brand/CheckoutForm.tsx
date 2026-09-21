'use client';

import { useActionState } from 'react';
import { Button } from './Button';
import { placeOrderAction, type CheckoutState } from '@/app/checkout/actions';
import type { Address, PaymentMethod } from '@/db/schema';

const BRAND_LABEL: Record<PaymentMethod['brand'], string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'American Express',
};

export function CheckoutForm({
  addresses,
  paymentMethods,
  expectedTotalCents,
  summary,
}: {
  addresses: Address[];
  paymentMethods: PaymentMethod[];
  expectedTotalCents: number;
  summary: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState<CheckoutState, FormData>(
    placeOrderAction,
    {},
  );

  const defaultAddress = addresses.find((a) => a.isDefault) ?? addresses[0];
  const defaultCard = paymentMethods.find((c) => c.isDefault) ?? paymentMethods[0];

  return (
    <form action={formAction} className="grid gap-10 lg:grid-cols-[1fr_320px]">
      <input type="hidden" name="expectedTotalCents" value={expectedTotalCents} />

      <div className="space-y-10">
        <section>
          <h2 className="display border-b border-rule pb-2 text-lg">Ship to</h2>
          <div className="mt-4 space-y-3">
            {addresses.map((address) => (
              <label
                key={address.id}
                className="flex cursor-pointer gap-3 rounded-[5px] border border-rule bg-surface p-4 has-checked:border-spruce"
              >
                <input
                  type="radio"
                  name="addressId"
                  value={address.id}
                  defaultChecked={address.id === defaultAddress?.id}
                  className="mt-1 accent-[#2e5a4b]"
                />
                <span className="text-sm leading-relaxed">
                  <span className="block text-[10px] font-semibold uppercase tracking-[0.13em] text-muted">
                    {address.label}
                  </span>
                  <span className="block">{address.recipient}</span>
                  <span className="block text-muted">
                    {address.line1}
                    {address.line2 ? `, ${address.line2}` : ''}, {address.city}{' '}
                    {address.region} {address.postalCode}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </section>

        <section>
          <h2 className="display border-b border-rule pb-2 text-lg">Pay with</h2>
          <div className="mt-4 space-y-3">
            {paymentMethods.map((card) => (
              <label
                key={card.id}
                className="flex cursor-pointer gap-3 rounded-[5px] border border-rule bg-surface p-4 has-checked:border-spruce"
              >
                <input
                  type="radio"
                  name="paymentMethodId"
                  value={card.id}
                  defaultChecked={card.id === defaultCard?.id}
                  className="mt-1 accent-[#2e5a4b]"
                />
                <span className="text-sm leading-relaxed">
                  <span className="block">
                    {BRAND_LABEL[card.brand]} ···· {card.last4}
                  </span>
                  <span className="block text-muted tabular-nums">
                    Expires {String(card.expMonth).padStart(2, '0')}/{card.expYear}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted">
            Nothing is charged. No payment is processed anywhere in this app.
          </p>
        </section>
      </div>

      <div className="lg:sticky lg:top-8 lg:self-start">
        {summary}
        {state.error && <p className="mt-4 text-sm text-ember">{state.error}</p>}
        <Button type="submit" disabled={pending} className="mt-5 w-full">
          {pending ? 'Placing order…' : 'Place order'}
        </Button>
      </div>
    </form>
  );
}
