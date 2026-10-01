import Link from 'next/link';
import { ProfileForm } from '@/components/brand/AccountForms';
import { requireCustomer } from '@/lib/auth/session-cookie';
import { getProfile } from '@/lib/services/profile';
import { browserContext } from '@/lib/oauth/types';

const dateFormat = new Intl.DateTimeFormat('en-US', {
  year: 'numeric', month: 'long',
});

const SECTIONS = [
  ['/account/addresses', 'Saved addresses', 'Where your orders go.'],
  ['/account/payment-methods', 'Payment methods', 'Brand and last four digits only.'],
  ['/orders', 'Order history', 'Everything you have bought.'],
] as const;

export default async function AccountPage() {
  const customer = await requireCustomer();
  const profile = await getProfile(browserContext(customer.id));

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="display text-3xl">Account</h1>

      <section className="mt-8 rounded-lg border border-rule bg-surface p-6">
        <h2 className="display text-lg">Profile</h2>

        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
          <span className="text-muted">{profile.email}</span>
          <span
            className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] ${
              profile.emailVerified ? 'bg-spruce/10 text-spruce' : 'bg-ember/10 text-ember'
            }`}
          >
            {profile.emailVerified ? 'Verified' : 'Unverified'}
          </span>
        </div>
        <p className="mt-2 text-xs text-muted">
          Customer since {dateFormat.format(profile.createdAt)}. Email cannot be
          changed here — it would need re-verification.
        </p>

        <div className="mt-6">
          <ProfileForm name={profile.name} />
        </div>
      </section>

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {SECTIONS.map(([href, title, blurb]) => (
          <Link
            key={href}
            href={href}
            className="group block rounded-lg border border-rule bg-surface p-5"
          >
            <div className="display text-[15px] group-hover:text-spruce">{title}</div>
            <p className="mt-1 text-sm text-muted">{blurb}</p>
          </Link>
        ))}
      </div>
    </main>
  );
}
