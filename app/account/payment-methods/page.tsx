import { PaymentMethodForm } from '@/components/brand/AccountForms';
import { ButtonLink } from '@/components/brand/Button';
import { RowActionButton } from '@/components/brand/RowActions';
import { requireCustomer } from '@/lib/auth/session-cookie';
import { listPaymentMethods } from '@/lib/services/paymentMethods';
import { deletePaymentMethodAction, setDefaultPaymentMethodAction } from '../actions';
import { browserContext } from '@/lib/oauth/types';

const BRAND_LABEL = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'American Express',
} as const;

export default async function PaymentMethodsPage() {
  const customer = await requireCustomer();
  const cards = await listPaymentMethods(browserContext(customer.id));

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="display text-3xl">Payment methods</h1>
      <p className="mt-2 max-w-[60ch] text-sm text-muted">
        Northbound stores the brand, the last four digits, and the expiry. There
        is no field in this application, and no column in its database, that a
        full card number could be written to.
      </p>

      {cards.length === 0 ? (
        <p className="mt-6 text-muted">No payment methods saved yet.</p>
      ) : (
        <ul className="mt-8 grid gap-4 sm:grid-cols-2">
          {cards.map((card) => (
            <li key={card.id} className="rounded-lg border border-rule bg-surface p-5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm">
                  {BRAND_LABEL[card.brand]} ···· {card.last4}
                </span>
                {card.isDefault && (
                  <span className="rounded-full bg-spruce/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-spruce">
                    Default
                  </span>
                )}
              </div>

              <p className="mt-2 text-sm text-muted tabular-nums">
                {card.holderName} · expires{' '}
                {String(card.expMonth).padStart(2, '0')}/{card.expYear}
              </p>

              <div className="mt-4 flex flex-wrap items-start gap-5">
                {!card.isDefault && (
                  <RowActionButton
                    action={setDefaultPaymentMethodAction}
                    id={card.id}
                    label="Make default"
                    pendingLabel="Saving…"
                  />
                )}
                <RowActionButton
                  action={deletePaymentMethodAction}
                  id={card.id}
                  label="Delete"
                  pendingLabel="Deleting…"
                  tone="ember"
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      <section className="mt-12 rounded-lg border border-rule bg-surface p-6">
        <h2 className="display text-lg">Add a payment method</h2>
        <div className="mt-5">
          <PaymentMethodForm />
        </div>
      </section>

      <div className="mt-8">
        <ButtonLink href="/account" variant="secondary">Back to account</ButtonLink>
      </div>
    </main>
  );
}
