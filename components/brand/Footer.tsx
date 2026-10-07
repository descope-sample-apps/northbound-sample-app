import Link from 'next/link';

const COLUMNS = [
  {
    heading: 'Shop',
    links: [
      ['/shop/outerwear', 'Outerwear'],
      ['/shop/packs-bags', 'Packs & Bags'],
      ['/shop/shelter-sleep', 'Shelter & Sleep'],
      ['/shop', 'Everything'],
    ],
  },
  {
    heading: 'Account',
    links: [
      ['/orders', 'Order history'],
      ['/account/addresses', 'Saved addresses'],
      ['/account/payment-methods', 'Payment methods'],
      ['/account', 'Settings'],
    ],
  },
] as const;

export function Footer() {
  return (
    <footer className="mt-24 border-t border-rule">
      <div className="mx-auto grid max-w-6xl gap-10 px-6 py-14 sm:grid-cols-3">
        <div>
          <div className="display text-xl text-spruce">Northbound</div>
          <p className="mt-2 max-w-[34ch] text-sm leading-relaxed text-muted">
            Outdoor gear and apparel, built to be repaired rather than replaced.
            Portland, Oregon.
          </p>
        </div>

        {COLUMNS.map((column) => (
          <div key={column.heading}>
            <div className="text-[10px] font-semibold uppercase tracking-[0.13em] text-muted">
              {column.heading}
            </div>
            <ul className="mt-3 space-y-2">
              {column.links.map(([href, label]) => (
                <li key={href}>
                  <Link href={href} className="text-sm hover:text-spruce">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="border-t border-rule">
        <p className="mx-auto max-w-6xl px-6 py-5 text-xs text-muted">
          Northbound is a demo store from Descope for trying AI agents that shop
          for you. Checkout works and orders are real in the demo, but no
          payment is charged and nothing ships.
        </p>
      </div>
    </footer>
  );
}
