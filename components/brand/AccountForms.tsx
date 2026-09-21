'use client';

import { useActionState } from 'react';
import { Button } from './Button';
import { Field } from './Field';
import {
  addPaymentMethodAction,
  saveAddressAction,
  updateProfileAction,
  type AccountState,
} from '@/app/account/actions';
import type { Address } from '@/db/schema';

function Status({ state, savedLabel }: { state: AccountState; savedLabel: string }) {
  if (state.error) return <p className="text-sm text-ember">{state.error}</p>;
  if (state.saved) return <p className="text-sm text-spruce">{savedLabel}</p>;
  return null;
}

export function ProfileForm({ name }: { name: string }) {
  const [state, formAction, pending] = useActionState<AccountState, FormData>(
    updateProfileAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-4">
      <Field label="Name" name="name" defaultValue={name} required />
      <Status state={state} savedLabel="Saved." />
      <Button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Save'}
      </Button>
    </form>
  );
}

export function AddressForm({ address }: { address?: Address }) {
  const [state, formAction, pending] = useActionState<AccountState, FormData>(
    saveAddressAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-4">
      {address && <input type="hidden" name="id" value={address.id} />}

      <Field label="Label" name="label" defaultValue={address?.label ?? ''} required />
      <Field label="Recipient" name="recipient" defaultValue={address?.recipient ?? ''} required />
      <Field label="Street address" name="line1" defaultValue={address?.line1 ?? ''} required />
      <Field label="Apartment, suite" name="line2" defaultValue={address?.line2 ?? ''} />

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="City" name="city" defaultValue={address?.city ?? ''} required />
        <Field label="State" name="region" defaultValue={address?.region ?? ''} required />
        <Field label="Postal code" name="postalCode" defaultValue={address?.postalCode ?? ''} required />
      </div>

      <Field label="Phone" name="phone" defaultValue={address?.phone ?? ''} />

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox" name="isDefault" defaultChecked={address?.isDefault}
          className="accent-[#2e5a4b]"
        />
        Use as my default address
      </label>

      <Status state={state} savedLabel="Address saved." />
      <Button type="submit" disabled={pending}>
        {pending ? 'Saving…' : address ? 'Save changes' : 'Add address'}
      </Button>
    </form>
  );
}

export function PaymentMethodForm() {
  const [state, formAction, pending] = useActionState<AccountState, FormData>(
    addPaymentMethodAction,
    {},
  );

  const thisYear = new Date().getFullYear();

  return (
    <form action={formAction} className="space-y-4">
      <Field label="Cardholder name" name="holderName" required />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Brand" name="brand">
          <select
            name="brand"
            className="w-full rounded-[3px] border border-rule bg-surface px-3 py-2.5 text-[15px] outline-none focus:border-spruce"
          >
            <option value="visa">Visa</option>
            <option value="mastercard">Mastercard</option>
            <option value="amex">American Express</option>
          </select>
        </Field>

        {/*
          SECURITY: last four digits only. There is no field here, and no column
          in the database, that a full card number could go into. An agent is
          denied this operation outright in sub-project D.
        */}
        <Field
          label="Last four digits"
          name="last4"
          inputMode="numeric"
          maxLength={4}
          pattern="\d{4}"
          required
          hint="Only the last four. Never enter a full card number."
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Expiry month" name="expMonth" type="number" min={1} max={12} required />
        <Field
          label="Expiry year" name="expYear" type="number"
          min={thisYear} max={2099} defaultValue={thisYear + 3} required
        />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="isDefault" className="accent-[#2e5a4b]" />
        Use as my default payment method
      </label>

      <Status state={state} savedLabel="Card saved." />
      <Button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Add payment method'}
      </Button>
    </form>
  );
}
