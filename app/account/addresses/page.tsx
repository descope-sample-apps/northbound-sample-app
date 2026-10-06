import { AddressForm } from '@/components/brand/AccountForms';
import { ButtonLink } from '@/components/brand/Button';
import { RowActionButton } from '@/components/brand/RowActions';
import { requireCustomer } from '@/lib/auth/session-cookie';
import { listAddresses } from '@/lib/services/addresses';
import { deleteAddressAction, setDefaultAddressAction } from '../actions';

export default async function AddressesPage() {
  const customer = await requireCustomer();
  const addresses = await listAddresses(customer.id);

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="display text-3xl">Saved addresses</h1>

      {addresses.length === 0 ? (
        <p className="mt-6 text-muted">No addresses saved yet.</p>
      ) : (
        <ul className="mt-8 grid gap-4 sm:grid-cols-2">
          {addresses.map((address) => (
            <li key={address.id} className="rounded-lg border border-rule bg-surface p-5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[10px] font-semibold uppercase tracking-[0.13em] text-muted">
                  {address.label}
                </span>
                {address.isDefault && (
                  <span className="rounded-full bg-spruce/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-spruce">
                    Default
                  </span>
                )}
              </div>

              <address className="mt-3 text-sm not-italic leading-relaxed">
                {address.recipient}<br />
                {address.line1}{address.line2 ? `, ${address.line2}` : ''}<br />
                {address.city}, {address.region} {address.postalCode}
              </address>

              <div className="mt-4 flex flex-wrap items-start gap-5">
                {!address.isDefault && (
                  <RowActionButton
                    action={setDefaultAddressAction}
                    id={address.id}
                    label="Make default"
                    pendingLabel="Saving…"
                  />
                )}
                <RowActionButton
                  action={deleteAddressAction}
                  id={address.id}
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
        <h2 className="display text-lg">Add an address</h2>
        <div className="mt-5">
          <AddressForm />
        </div>
      </section>

      <div className="mt-8">
        <ButtonLink href="/account" variant="secondary">Back to account</ButtonLink>
      </div>
    </main>
  );
}
