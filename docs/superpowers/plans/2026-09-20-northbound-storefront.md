# Northbound Storefront Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Northbound, an outdoor-gear ecommerce storefront with catalog, cart, checkout, order history, account management, and email-and-password login, containing no agent or OAuth concepts anywhere.

**Architecture:** Next.js App Router with server components reading through a service layer; server actions for mutations. `lib/services/*` is the only code that touches Drizzle, takes `customerId` as its first argument, validates with Zod, and throws typed errors. Sessions are opaque database-backed tokens in an httpOnly cookie, never JWTs. Bob's password lives in a simulated legacy backend reached only over HTTP.

**Tech Stack:** Next.js 15 (App Router), TypeScript, Tailwind v4, shadcn/ui, Drizzle ORM, `@libsql/client`, Zod, Vitest, `next/font/google` (Fraunces + Figtree).

**Spec:** [docs/superpowers/specs/2026-09-20-northbound-storefront-design.md](../specs/2026-09-20-northbound-storefront-design.md)

## Global Constraints

- Package manager is **pnpm** (10.15.0, activated via corepack). A single `pnpm dev` must run everything with no external services.
- Node **v24.18.0**. No native-build dependencies — password hashing uses `scrypt` from `node:crypto`.
- **No agent, OAuth, actor, scope, or policy concept appears anywhere in `app/` or `lib/services/`.** `ActorContext` is introduced in sub-project B, not here.
- Service functions take `customerId` as the **first argument** and scope every query by it.
- **Services are the only code that imports from `db/`.** Server components and server actions call services.
- Validation is Zod, at the **service boundary** — never in a server action.
- Services throw `NotFoundError | OwnershipError | OutOfStockError | ValidationError`. They never return HTTP status codes.
- `db/schema/legacy.ts` may be imported **only** by `app/legacy-auth/verify/route.ts`.
- Money is integer cents everywhere. Order: shipping keys off `subtotal_cents` (`$0` when `>= 7500`, else `895`); tax is `8.5%` of `subtotal_cents` only; `total_cents = subtotal + shipping + tax`.
- No secrets in the repo. `.env.example` only.
- `data/*.db` is gitignored; `pnpm db:setup` rebuilds deterministically.
- Colour tokens exactly: `--paper #FBF7F0`, `--surface #FFFFFF`, `--ink #1B2620`, `--spruce #2E5A4B`, `--ember #C0572F`, `--muted #7A8479`, `--rule #E3DCCD`.
- Seeded order numbers are **10225–10240**; the next order placed is **#10241**.

## Review Focus

Five failure modes the spec implies but does not enumerate. Each has a test assigned to the task that owns the code.

1. **Concurrent checkout oversells stock or duplicates an order number.** Two simultaneous `placeOrder` calls for the last unit must not both succeed, and must never produce two orders with the same `order_number`. → Task 9.
2. **A cart item goes inactive or out of stock between add and checkout.** Checkout must fail with a clear, actionable error naming the product — not a 500 and not a silent drop. → Task 9.
3. **Price changes between cart display and checkout.** The customer must be charged the price they were shown, or told the price moved. Snapshotting silently at order time charges a surprise amount. → Task 9.
4. **An expired or revoked session is presented mid-flow.** Must fail closed with a redirect to `/login`, never a crash and never a partial render as an authenticated user. → Task 6.
5. **Non-positive, non-integer, or absurd quantities in `addToCart`.** `0`, `-3`, `2.5`, and `999999` must all be rejected at the service boundary. → Task 8.

---

## File Structure

```
package.json  tsconfig.json  next.config.ts  postcss.config.mjs  drizzle.config.ts
.env.example  vitest.config.ts

db/
  client.ts                 libsql client + drizzle instance
  schema/
    index.ts                re-exports APP schema only — never legacy
    customers.ts            customers, sessions
    catalog.ts              categories, products
    commerce.ts             carts, cart_items, orders, order_items
    account.ts              addresses, payment_methods
    legacy.ts               legacy_credentials — ISOLATED
  seed/
    index.ts                orchestrator
    images.ts               64 pinned Unsplash photo IDs
    catalog.ts              8 categories, 64 products
    customers.ts            Alice, Bob, Carol + legacy row
    account.ts              addresses, payment methods
    orders.ts               16 orders, #10225–10240

lib/
  money.ts                  calcTotals, formatCents
  auth/
    password.ts             scrypt hash/verify/dummy
    verify.ts               verifyCredentials() backend dispatch
    session.ts              createSession, getCurrentCustomer, revokeSession
  services/
    errors.ts               typed error classes
    catalog.ts  cart.ts  orders.ts  profile.ts  addresses.ts  paymentMethods.ts

app/
  layout.tsx  globals.css  page.tsx
  shop/page.tsx  shop/[category]/page.tsx
  product/[slug]/page.tsx
  cart/page.tsx  cart/actions.ts
  checkout/page.tsx  checkout/actions.ts
  checkout/confirmation/[orderNumber]/page.tsx
  orders/page.tsx  orders/[orderNumber]/page.tsx
  account/page.tsx  account/actions.ts
  account/addresses/page.tsx  account/payment-methods/page.tsx
  login/page.tsx  login/actions.ts  signup/page.tsx
  legacy-auth/verify/route.ts

components/
  brand/Button.tsx  Nav.tsx  Footer.tsx  ProductCard.tsx  Price.tsx  Field.tsx

scripts/fetch-images.ts
test/harness.ts
```

---

## Task 1: Toolchain and branded shell

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `vitest.config.ts`, `.env.example`
- Create: `app/layout.tsx`, `app/globals.css`, `app/page.tsx`
- Test: `test/smoke.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `pnpm dev`, `pnpm test`, `pnpm build`. CSS custom properties listed in Global Constraints. Fonts exported from `app/layout.tsx` as `fraunces` and `figtree` (`next/font/google` objects exposing `.variable`).

- [ ] **Step 1: Scaffold and install**

```bash
pnpm dlx create-next-app@latest . --ts --tailwind --app --no-src-dir \
  --import-alias "@/*" --use-pnpm --eslint --skip-install --yes
pnpm add drizzle-orm @libsql/client zod
pnpm add -D drizzle-kit vitest @types/node tsx sharp
```

- [ ] **Step 2: Add scripts to `package.json`**

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "tsx db/migrate.ts",
    "db:seed": "tsx db/seed/index.ts",
    "db:setup": "pnpm db:migrate && pnpm db:seed",
    "images:fetch": "tsx scripts/fetch-images.ts"
  }
}
```

- [ ] **Step 3: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: { environment: 'node', include: ['test/**/*.test.ts'], pool: 'forks' },
  resolve: { alias: { '@': path.resolve(__dirname, '.') } },
});
```

- [ ] **Step 4: Write `.env.example`**

```bash
# Local SQLite file. Point at a Turso URL for a persistent hosted demo.
DATABASE_URL="file:./data/northbound.db"

# Shared secret the storefront and (later) the authorization server use to call
# the simulated legacy auth backend. Server-to-server only; never sent to a browser.
LEGACY_AUTH_SERVICE_TOKEN="dev-only-legacy-token"
```

- [ ] **Step 5: Write `app/globals.css` with the brand tokens**

```css
@import "tailwindcss";

@theme {
  --color-paper:   #FBF7F0;
  --color-surface: #FFFFFF;
  --color-ink:     #1B2620;
  --color-spruce:  #2E5A4B;
  --color-ember:   #C0572F;
  --color-muted:   #7A8479;
  --color-rule:    #E3DCCD;
  --font-display: var(--font-fraunces), Georgia, serif;
  --font-sans:    var(--font-figtree), system-ui, sans-serif;
}

body { background: var(--color-paper); color: var(--color-ink); font-family: var(--font-sans); }
h1, h2, h3, .display { font-family: var(--font-display); font-weight: 600; font-variation-settings: 'SOFT' 20; }
```

- [ ] **Step 6: Write `app/layout.tsx`**

```tsx
import type { Metadata } from 'next';
import { Fraunces, Figtree } from 'next/font/google';
import './globals.css';

const fraunces = Fraunces({
  subsets: ['latin'], variable: '--font-fraunces',
  axes: ['SOFT', 'WONK'], weight: ['400', '600', '700'],
});
const figtree = Figtree({ subsets: ['latin'], variable: '--font-figtree', weight: ['400', '500', '600'] });

export const metadata: Metadata = {
  title: 'Northbound — Outdoor Gear & Apparel',
  description: 'Gear that earns its place on your back.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${figtree.variable}`}>
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 7: Write `app/page.tsx` as a temporary shell**

```tsx
export default function Home() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-24">
      <p className="text-xs uppercase tracking-[0.16em] text-ember font-semibold">New for autumn</p>
      <h1 className="display text-5xl leading-tight mt-3">Gear that earns its place on your back.</h1>
    </main>
  );
}
```

- [ ] **Step 8: Write the smoke test**

```ts
// test/smoke.test.ts
import { describe, it, expect } from 'vitest';

describe('toolchain', () => {
  it('runs typescript and resolves the @ alias', async () => {
    const mod = await import('@/app/layout');
    expect(typeof mod.default).toBe('function');
  });
});
```

- [ ] **Step 9: Verify**

Run: `pnpm test` → Expected: PASS.
Run: `pnpm build` → Expected: build succeeds with no type errors.
Run: `pnpm dev`, open `http://localhost:3000` → Expected: cream page, Fraunces headline, ember eyebrow.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: scaffold Next.js app with Northbound brand tokens and Vitest"
```

---

## Task 2: Database schema and client

**Files:**
- Create: `db/client.ts`, `db/migrate.ts`, `drizzle.config.ts`
- Create: `db/schema/{index,customers,catalog,commerce,account,legacy}.ts`
- Test: `test/schema.test.ts`

**Interfaces:**
- Consumes: Task 1's toolchain.
- Produces:
  - `db` — Drizzle instance; `sqlite` — raw libsql client.
  - Tables: `customers`, `sessions`, `categories`, `products`, `carts`, `cartItems`, `orders`, `orderItems`, `addresses`, `paymentMethods`, and (isolated) `legacyCredentials`.
  - Inferred types `Customer`, `Product`, `Order`, `OrderItem`, `Address`, `PaymentMethod` via `typeof table.$inferSelect`.

- [ ] **Step 1: Write `db/client.ts`**

```ts
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from './schema';

const url = process.env.DATABASE_URL ?? 'file:./data/northbound.db';
export const sqlite = createClient({ url });
export const db = drizzle(sqlite, { schema });
export type DB = typeof db;
```

- [ ] **Step 2: Write `db/schema/customers.ts`**

```ts
import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';

export const customers = sqliteTable('customers', {
  id: integer('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  // NULL for customers whose credential lives in the legacy backend (Bob).
  passwordHash: text('password_hash'),
  // Dispatch discriminator for login. 'local' verifies against password_hash;
  // 'legacy' delegates over HTTP to /legacy-auth/verify.
  authBackend: text('auth_backend', { enum: ['local', 'legacy'] }).notNull(),
  // Provenance only. No behavioural effect in the storefront.
  signupOrigin: text('signup_origin', { enum: ['web', 'google'] }).notNull(),
  passwordSetAt: integer('password_set_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

// SECURITY BOUNDARY: `id` is 32 random bytes and is the raw cookie value.
// It carries no claims and no signature, and means nothing outside this table.
// This is deliberate: a JWT session cookie would be SHAPED like a bearer token,
// and only a check would stop it being presented to an API. An opaque database
// token cannot be validated as an access token by any code path.
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  customerId: integer('customer_id').notNull().references(() => customers.id),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  lastSeenAt: integer('last_seen_at', { mode: 'timestamp' }).notNull(),
  revokedAt: integer('revoked_at', { mode: 'timestamp' }),
  userAgent: text('user_agent'),
});

export type Customer = typeof customers.$inferSelect;
export type Session = typeof sessions.$inferSelect;
```

- [ ] **Step 3: Write `db/schema/catalog.ts`**

```ts
import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';

export const categories = sqliteTable('categories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  sortOrder: integer('sort_order').notNull(),
});

export const products = sqliteTable('products', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sku: text('sku').notNull().unique(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  categoryId: integer('category_id').notNull().references(() => categories.id),
  priceCents: integer('price_cents').notNull(),
  imagePath: text('image_path').notNull(),
  stockQty: integer('stock_qty').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export type Category = typeof categories.$inferSelect;
export type Product = typeof products.$inferSelect;
```

- [ ] **Step 4: Write `db/schema/commerce.ts`**

```ts
import { sqliteTable, integer, text, unique } from 'drizzle-orm/sqlite-core';
import { customers } from './customers';
import { products } from './catalog';
import { addresses, paymentMethods } from './account';

export const carts = sqliteTable('carts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  customerId: integer('customer_id').notNull().references(() => customers.id).unique(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

// No price column: the cart shows live price. Price snapshots at order time only.
export const cartItems = sqliteTable('cart_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  cartId: integer('cart_id').notNull().references(() => carts.id),
  productId: integer('product_id').notNull().references(() => products.id),
  quantity: integer('quantity').notNull(),
}, (t) => ({ uniqueLine: unique().on(t.cartId, t.productId) }));

export const orders = sqliteTable('orders', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  // Distinct from the PK, and UNIQUE so a concurrent allocation race fails loudly
  // rather than producing two orders that share a number.
  orderNumber: integer('order_number').notNull().unique(),
  customerId: integer('customer_id').notNull().references(() => customers.id),
  status: text('status', { enum: ['placed', 'shipped', 'delivered', 'cancelled'] }).notNull(),
  placedAt: integer('placed_at', { mode: 'timestamp' }).notNull(),
  subtotalCents: integer('subtotal_cents').notNull(),
  taxCents: integer('tax_cents').notNull(),
  shippingCents: integer('shipping_cents').notNull(),
  totalCents: integer('total_cents').notNull(),
  shippingAddressId: integer('shipping_address_id').notNull().references(() => addresses.id),
  paymentMethodId: integer('payment_method_id').notNull().references(() => paymentMethods.id),
});

// name_snapshot and unit_price_cents exist so order history does not silently
// rewrite itself when the catalog is edited.
export const orderItems = sqliteTable('order_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  orderId: integer('order_id').notNull().references(() => orders.id),
  productId: integer('product_id').notNull().references(() => products.id),
  nameSnapshot: text('name_snapshot').notNull(),
  unitPriceCents: integer('unit_price_cents').notNull(),
  quantity: integer('quantity').notNull(),
  lineTotalCents: integer('line_total_cents').notNull(),
});

export type Order = typeof orders.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
```

- [ ] **Step 5: Write `db/schema/account.ts`**

```ts
import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';
import { customers } from './customers';

export const addresses = sqliteTable('addresses', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  customerId: integer('customer_id').notNull().references(() => customers.id),
  label: text('label').notNull(),
  recipient: text('recipient').notNull(),
  line1: text('line1').notNull(),
  line2: text('line2'),
  city: text('city').notNull(),
  region: text('region').notNull(),
  postalCode: text('postal_code').notNull(),
  country: text('country').notNull().default('US'),
  phone: text('phone'),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

// SECURITY BOUNDARY: there is deliberately no column a real PAN could be written
// to. Brand, last four, expiry and holder name only. This is enforced by the
// schema rather than by a code comment on purpose.
export const paymentMethods = sqliteTable('payment_methods', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  customerId: integer('customer_id').notNull().references(() => customers.id),
  brand: text('brand', { enum: ['visa', 'mastercard', 'amex'] }).notNull(),
  last4: text('last4').notNull(),
  expMonth: integer('exp_month').notNull(),
  expYear: integer('exp_year').notNull(),
  holderName: text('holder_name').notNull(),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export type Address = typeof addresses.$inferSelect;
export type PaymentMethod = typeof paymentMethods.$inferSelect;
```

- [ ] **Step 6: Write `db/schema/legacy.ts`**

```ts
// ============================================================================
// SIMULATED LEGACY AUTH BACKEND — NOT PART OF THE NORTHBOUND APPLICATION
// ============================================================================
// This table stands in for a 2019 authentication system that Northbound does
// not own and cannot schema-migrate. It shares a SQLite file with the rest of
// the app only because the project forbids external services.
//
// There is deliberately NO foreign key to `customers`: the legacy system knows
// nothing about Northbound's customer records and keys on its own identifier.
//
// IMPORT RULE: the only module permitted to import this file is
// `app/legacy-auth/verify/route.ts`. Every other caller — the storefront login
// action, and later the authorization server — reaches it over HTTP.
// ============================================================================
import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';

export const legacyCredentials = sqliteTable('legacy_credentials', {
  legacyUserId: integer('legacy_user_id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});
```

- [ ] **Step 7: Write `db/schema/index.ts`**

```ts
// Application schema only. `legacy.ts` is intentionally NOT re-exported here —
// see the import rule in that file.
export * from './customers';
export * from './catalog';
export * from './commerce';
export * from './account';
```

- [ ] **Step 8: Write `drizzle.config.ts` and `db/migrate.ts`**

```ts
// drizzle.config.ts
import type { Config } from 'drizzle-kit';
export default {
  schema: ['./db/schema/index.ts', './db/schema/legacy.ts'],
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'file:./data/northbound.db' },
} satisfies Config;
```

```ts
// db/migrate.ts
import { migrate } from 'drizzle-orm/libsql/migrator';
import { mkdirSync } from 'node:fs';
import { db } from './client';

mkdirSync('./data', { recursive: true });
await migrate(db, { migrationsFolder: './drizzle' });
console.log('migrations applied');
```

- [ ] **Step 9: Generate migrations and write the schema test**

```bash
pnpm db:generate
```

```ts
// test/schema.test.ts
import { describe, it, expect } from 'vitest';
import * as appSchema from '@/db/schema';
import { readFileSync } from 'node:fs';

describe('schema', () => {
  it('exports every application table', () => {
    for (const t of ['customers','sessions','categories','products','carts',
                     'cartItems','orders','orderItems','addresses','paymentMethods']) {
      expect(appSchema).toHaveProperty(t);
    }
  });

  it('does NOT re-export the legacy credentials table from the app schema', () => {
    expect(appSchema).not.toHaveProperty('legacyCredentials');
  });

  it('has no column that could hold a full card number', () => {
    const src = readFileSync('db/schema/account.ts', 'utf8');
    expect(src).not.toMatch(/card_number|pan|full_number|cvv|cvc/i);
  });
});
```

- [ ] **Step 10: Verify and commit**

Run: `pnpm db:migrate && pnpm test` → Expected: migrations apply, 3 schema tests PASS.

```bash
git add -A
git commit -m "feat: add Drizzle schema, libsql client, and migrations"
```

---

## Task 3: Test harness

**Files:**
- Create: `test/harness.ts`
- Test: `test/harness.test.ts`

**Interfaces:**
- Consumes: `db/schema/*`, `drizzle/` migrations from Task 2.
- Produces:
  - `withTestDb(): Promise<TestDb>` where `TestDb = { db: LibSQLDatabase<typeof schema>; sqlite: Client; close(): Promise<void> }`.
  - `seedMinimal(tdb: TestDb): Promise<{ alice: number; bob: number; carol: number; productIds: number[] }>` — three customers, one category, three products, one address and one payment method each. Used by every later task's tests.

This harness is the most reused artifact in the repository. Every required test in sub-projects B through E runs on it.

- [ ] **Step 1: Write `test/harness.ts`**

```ts
import { createClient, type Client } from '@libsql/client';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import * as schema from '@/db/schema';
import { legacyCredentials } from '@/db/schema/legacy';
import { hashPassword } from '@/lib/auth/password';

export type TestDb = {
  db: LibSQLDatabase<typeof schema>;
  sqlite: Client;
  close: () => Promise<void>;
};

export async function withTestDb(): Promise<TestDb> {
  const sqlite = createClient({ url: ':memory:' });
  const db = drizzle(sqlite, { schema });
  await migrate(db, { migrationsFolder: './drizzle' });
  return { db, sqlite, close: async () => { sqlite.close(); } };
}

export async function seedMinimal(tdb: TestDb) {
  const { db } = tdb;
  const now = new Date();
  const pw = await hashPassword('password123');

  await db.insert(schema.customers).values([
    { id: 82731, email: 'alice@example.com', name: 'Alice Chen', emailVerified: true,
      passwordHash: pw, authBackend: 'local', signupOrigin: 'web',
      passwordSetAt: now, createdAt: now },
    { id: 19382, email: 'bob@example.com', name: 'Bob Ferreira', emailVerified: false,
      passwordHash: null, authBackend: 'legacy', signupOrigin: 'web',
      passwordSetAt: null, createdAt: now },
    { id: 44102, email: 'carol@example.com', name: 'Carol Nwosu', emailVerified: true,
      passwordHash: pw, authBackend: 'local', signupOrigin: 'google',
      passwordSetAt: now, createdAt: now },
  ]);

  await db.insert(legacyCredentials).values({
    legacyUserId: 5501, email: 'bob@example.com',
    passwordHash: await hashPassword('legacy-pass-2019'), createdAt: now,
  });

  const [cat] = await db.insert(schema.categories)
    .values({ slug: 'packs-bags', name: 'Packs & Bags', description: 'Carry systems.', sortOrder: 1 })
    .returning();

  const products = await db.insert(schema.products).values([
    { sku: 'NB-PK-001', slug: 'cascade-45l', name: 'Cascade 45L Expedition Pack',
      description: 'A 45-litre haul bag.', categoryId: cat.id, priceCents: 42000,
      imagePath: '/products/cascade-45l.webp', stockQty: 10, isActive: true, createdAt: now },
    { sku: 'NB-PK-002', slug: 'ridgeline-shell', name: 'Ridgeline 3L Hardshell',
      description: 'Three-layer waterproof shell.', categoryId: cat.id, priceCents: 48000,
      imagePath: '/products/ridgeline-shell.webp', stockQty: 1, isActive: true, createdAt: now },
    { sku: 'NB-PK-003', slug: 'trail-mug', name: 'Trail Enamel Mug',
      description: 'Twelve ounces.', categoryId: cat.id, priceCents: 1800,
      imagePath: '/products/trail-mug.webp', stockQty: 50, isActive: true, createdAt: now },
  ]).returning();

  for (const customerId of [82731, 19382, 44102]) {
    await db.insert(schema.addresses).values({
      customerId, label: 'Home', recipient: 'Recipient', line1: '1 Test Street',
      city: 'Portland', region: 'OR', postalCode: '97201', country: 'US',
      isDefault: true, createdAt: now,
    });
    await db.insert(schema.paymentMethods).values({
      customerId, brand: 'visa', last4: '4242', expMonth: 6, expYear: 2030,
      holderName: 'Test Holder', isDefault: true, createdAt: now,
    });
  }

  return { alice: 82731, bob: 19382, carol: 44102, productIds: products.map((p) => p.id) };
}
```

- [ ] **Step 2: Write `test/harness.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { withTestDb, seedMinimal, type TestDb } from './harness';

describe('test harness', () => {
  let tdb: TestDb;
  beforeEach(async () => { tdb = await withTestDb(); });
  afterEach(async () => { await tdb.close(); });

  it('creates an isolated database with migrations applied', async () => {
    const rows = await tdb.db.select().from(schema.customers);
    expect(rows).toHaveLength(0);
  });

  it('seeds the three customers with the expected ids', async () => {
    const ids = await seedMinimal(tdb);
    expect(ids).toMatchObject({ alice: 82731, bob: 19382, carol: 44102 });
  });

  it('gives Bob no local password hash', async () => {
    await seedMinimal(tdb);
    const [bob] = await tdb.db.select().from(schema.customers).where(eq(schema.customers.id, 19382));
    expect(bob.passwordHash).toBeNull();
    expect(bob.authBackend).toBe('legacy');
  });

  it('isolates databases between tests', async () => {
    const other = await withTestDb();
    await seedMinimal(tdb);
    const rows = await other.db.select().from(schema.customers);
    expect(rows).toHaveLength(0);
    await other.close();
  });
});
```

- [ ] **Step 3: Run and verify**

Run: `pnpm test test/harness.test.ts`
Expected: FAIL — `lib/auth/password` does not exist yet. This is the correct failure; Task 4 supplies it. If it fails for any other reason, fix that before proceeding.

- [ ] **Step 4: Commit**

```bash
git add test/harness.ts test/harness.test.ts
git commit -m "test: add reusable libsql test harness"
```

---

## Task 4: Money and password primitives

**Files:**
- Create: `lib/money.ts`, `lib/auth/password.ts`
- Test: `test/money.test.ts`, `test/password.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `calcTotals(subtotalCents: number): { subtotalCents; shippingCents; taxCents; totalCents }`
  - `formatCents(cents: number): string` — e.g. `"$420.00"`
  - `hashPassword(plain: string): Promise<string>`
  - `verifyPassword(plain: string, stored: string): Promise<boolean>`
  - `dummyVerify(plain: string): Promise<void>` — constant-work path for unknown emails

- [ ] **Step 1: Write the failing money test**

```ts
// test/money.test.ts
import { describe, it, expect } from 'vitest';
import { calcTotals, formatCents } from '@/lib/money';

describe('calcTotals', () => {
  it('charges flat shipping below the free threshold', () => {
    // $50.00 subtotal -> $8.95 shipping, tax on subtotal only
    expect(calcTotals(5000)).toEqual({
      subtotalCents: 5000, shippingCents: 895, taxCents: 425, totalCents: 6320,
    });
  });

  it('gives free shipping at exactly the threshold', () => {
    expect(calcTotals(7500).shippingCents).toBe(0);
  });

  it('does not tax shipping', () => {
    // 8.5% of 5000 is 425. If shipping were taxed it would be 501.
    expect(calcTotals(5000).taxCents).toBe(425);
  });

  it('handles an empty subtotal without inventing shipping tax', () => {
    expect(calcTotals(0)).toEqual({
      subtotalCents: 0, shippingCents: 895, taxCents: 0, totalCents: 895,
    });
  });

  it('rounds tax half-up to the cent', () => {
    // 8.5% of 4206 = 357.51 -> 358
    expect(calcTotals(4206).taxCents).toBe(358);
  });
});

describe('formatCents', () => {
  it('formats whole dollars with two decimals', () => {
    expect(formatCents(42000)).toBe('$420.00');
    expect(formatCents(1805)).toBe('$18.05');
    expect(formatCents(0)).toBe('$0.00');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm test test/money.test.ts`
Expected: FAIL — cannot resolve `@/lib/money`.

- [ ] **Step 3: Write `lib/money.ts`**

```ts
export const TAX_RATE_BPS = 850;                  // 8.5%, in basis points
export const FREE_SHIPPING_THRESHOLD_CENTS = 7500; // $75.00
export const FLAT_SHIPPING_CENTS = 895;            // $8.95

export type Totals = {
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
};

/**
 * Evaluated in a fixed order, because "shipping is free over $75" is ambiguous
 * about which figure it tests:
 *   1. shipping keys off SUBTOTAL
 *   2. tax is a percentage of SUBTOTAL ONLY — shipping is not taxed
 *   3. total is the sum
 *
 * Sub-project D's policy engine and the RAR `maximum_amount` ceiling both
 * compare against `totalCents`. Do not change that without changing both.
 */
export function calcTotals(subtotalCents: number): Totals {
  const shippingCents =
    subtotalCents >= FREE_SHIPPING_THRESHOLD_CENTS ? 0 : FLAT_SHIPPING_CENTS;
  const taxCents = Math.round((subtotalCents * TAX_RATE_BPS) / 10_000);
  return { subtotalCents, shippingCents, taxCents, totalCents: subtotalCents + shippingCents + taxCents };
}

export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
```

- [ ] **Step 4: Run the money test**

Run: `pnpm test test/money.test.ts` → Expected: PASS (6 tests).

- [ ] **Step 5: Write the failing password test**

```ts
// test/password.test.ts
import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, dummyVerify } from '@/lib/auth/password';

describe('password hashing', () => {
  it('round-trips a correct password', async () => {
    const stored = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', stored)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const stored = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('wrong password', stored)).toBe(false);
  });

  it('salts, so the same password hashes differently each time', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it('returns false rather than throwing on a malformed stored value', async () => {
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false);
    expect(await verifyPassword('x', '')).toBe(false);
    expect(await verifyPassword('x', 'bcrypt$aa$bb')).toBe(false);
  });

  it('dummyVerify resolves without throwing', async () => {
    await expect(dummyVerify('anything')).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 6: Run it and confirm it fails**

Run: `pnpm test test/password.test.ts`
Expected: FAIL — cannot resolve `@/lib/auth/password`.

- [ ] **Step 7: Write `lib/auth/password.ts`**

```ts
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (
  password: string, salt: Buffer, keylen: number
) => Promise<Buffer>;

const KEY_LEN = 32;
const SALT_LEN = 16;

/** Format: scrypt$<salt hex>$<key hex> */
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const key = await scrypt(plain, salt, KEY_LEN);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 3) return false;
  const [algo, saltHex, keyHex] = parts;
  if (algo !== 'scrypt' || !saltHex || !keyHex) return false;

  let expected: Buffer;
  try {
    expected = Buffer.from(keyHex, 'hex');
  } catch {
    return false;
  }
  if (expected.length !== KEY_LEN) return false;

  const actual = await scrypt(plain, Buffer.from(saltHex, 'hex'), KEY_LEN);
  return timingSafeEqual(actual, expected);
}

/**
 * SECURITY: run on the unknown-email path so that "no such user" and "wrong
 * password" cost the same wall-clock time. Without this, response timing
 * enumerates which email addresses have accounts.
 */
const DUMMY_HASH = `scrypt$${'0'.repeat(SALT_LEN * 2)}$${'0'.repeat(KEY_LEN * 2)}`;

export async function dummyVerify(plain: string): Promise<void> {
  await verifyPassword(plain, DUMMY_HASH);
}
```

- [ ] **Step 8: Run both tests plus the harness test**

Run: `pnpm test`
Expected: PASS — money (6), password (5), schema (3), harness (4), smoke (1). The harness test now passes because `lib/auth/password` exists.

- [ ] **Step 9: Commit**

```bash
git add lib/money.ts lib/auth/password.ts test/money.test.ts test/password.test.ts
git commit -m "feat: add money calculation and scrypt password primitives"
```

---

## Task 5: Simulated legacy auth backend

**Files:**
- Create: `app/legacy-auth/verify/route.ts`
- Test: `test/legacy-auth.test.ts`

**Interfaces:**
- Consumes: `legacyCredentials` (Task 2), `verifyPassword` / `dummyVerify` (Task 4).
- Produces: `POST /legacy-auth/verify` accepting `{ email, password }` with header `X-Legacy-Service-Token`, returning `{ ok: true, legacy_user_id: number }` or `{ ok: false }`. Also exports `verifyLegacyCredential(email, password): Promise<{ ok: boolean; legacyUserId?: number }>` for direct testing.

- [ ] **Step 1: Write the failing test**

```ts
// test/legacy-auth.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { withTestDb, seedMinimal, type TestDb } from './harness';

let tdb: TestDb;

vi.mock('@/db/client', () => ({
  get db() { return (globalThis as any).__testDb; },
}));

beforeEach(async () => {
  tdb = await withTestDb();
  await seedMinimal(tdb);
  (globalThis as any).__testDb = tdb.db;
  process.env.LEGACY_AUTH_SERVICE_TOKEN = 'test-token';
});
afterEach(async () => { await tdb.close(); });

async function post(body: unknown, token?: string) {
  const { POST } = await import('@/app/legacy-auth/verify/route');
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token !== undefined) headers['X-Legacy-Service-Token'] = token;
  return POST(new Request('http://localhost/legacy-auth/verify', {
    method: 'POST', headers, body: JSON.stringify(body),
  }));
}

describe('POST /legacy-auth/verify', () => {
  it('verifies a correct legacy credential', async () => {
    const res = await post({ email: 'bob@example.com', password: 'legacy-pass-2019' }, 'test-token');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, legacy_user_id: 5501 });
  });

  it('rejects a wrong password without revealing the user exists', async () => {
    const res = await post({ email: 'bob@example.com', password: 'nope' }, 'test-token');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false });
  });

  it('returns the same shape for an unknown email', async () => {
    const res = await post({ email: 'nobody@example.com', password: 'nope' }, 'test-token');
    expect(await res.json()).toEqual({ ok: false });
  });

  // SECURITY: this route is server-to-server only. A browser must never reach it.
  it('rejects a request with no service token', async () => {
    const res = await post({ email: 'bob@example.com', password: 'legacy-pass-2019' });
    expect(res.status).toBe(401);
  });

  it('rejects a request with the wrong service token', async () => {
    const res = await post({ email: 'bob@example.com', password: 'legacy-pass-2019' }, 'wrong');
    expect(res.status).toBe(401);
  });

  it('rejects a malformed body with 400, not 500', async () => {
    const res = await post({ email: 'bob@example.com' }, 'test-token');
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm test test/legacy-auth.test.ts`
Expected: FAIL — cannot resolve `@/app/legacy-auth/verify/route`.

- [ ] **Step 3: Write `app/legacy-auth/verify/route.ts`**

```ts
// ============================================================================
// SIMULATED LEGACY AUTHENTICATION BACKEND
// ============================================================================
// This route stands in for a 2019 authentication service that Northbound does
// not own. It is the ONLY module permitted to import `db/schema/legacy.ts`.
//
// SECURITY BOUNDARY — this is the load-bearing one for the whole project:
//
//   The customer's password is typed into Northbound's OWN form, posted to
//   Northbound's OWN server, and forwarded from there to this backend over a
//   server-side channel authenticated with a service token.
//
//   It never transits a browser-visible endpoint, and in sub-project C it will
//   never transit the OAuth client or the agent. The agent obtains a token; it
//   never obtains, observes, or replays the credential.
//
// This is the Descope Generic HTTP Connector pattern: the authorization
// experience calls an existing credential store over HTTP rather than
// migrating its password hashes.
//
// It is NOT mounted under /api/*, so it never collides with the bearer-only
// rule that sub-project B enforces on that namespace.
// ============================================================================
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { legacyCredentials } from '@/db/schema/legacy';
import { verifyPassword, dummyVerify } from '@/lib/auth/password';

const BodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function verifyLegacyCredential(
  email: string, password: string,
): Promise<{ ok: boolean; legacyUserId?: number }> {
  const [row] = await db.select().from(legacyCredentials)
    .where(eq(legacyCredentials.email, email.toLowerCase())).limit(1);

  // Constant-work path: an unknown email costs the same as a wrong password.
  if (!row) { await dummyVerify(password); return { ok: false }; }

  const ok = await verifyPassword(password, row.passwordHash);
  return ok ? { ok: true, legacyUserId: row.legacyUserId } : { ok: false };
}

export async function POST(request: Request): Promise<Response> {
  const expected = process.env.LEGACY_AUTH_SERVICE_TOKEN;
  const presented = request.headers.get('X-Legacy-Service-Token');
  if (!expected || presented !== expected) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  let parsed;
  try {
    parsed = BodySchema.safeParse(await request.json());
  } catch {
    return Response.json({ error: 'invalid_request' }, { status: 400 });
  }
  if (!parsed.success) return Response.json({ error: 'invalid_request' }, { status: 400 });

  const result = await verifyLegacyCredential(parsed.data.email, parsed.data.password);
  return result.ok
    ? Response.json({ ok: true, legacy_user_id: result.legacyUserId })
    : Response.json({ ok: false });
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm test test/legacy-auth.test.ts` → Expected: PASS (6 tests).

- [ ] **Step 5: Add the import-rule guard test**

Append to `test/legacy-auth.test.ts`:

```ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

describe('legacy schema isolation', () => {
  it('is imported only by the legacy verify route', () => {
    const offenders = ['app', 'lib', 'components']
      .flatMap((d) => walk(d))
      .filter((f) => f !== 'app/legacy-auth/verify/route.ts')
      .filter((f) => /schema\/legacy/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 6: Run and commit**

Run: `pnpm test test/legacy-auth.test.ts` → Expected: PASS (7 tests).

```bash
git add app/legacy-auth test/legacy-auth.test.ts
git commit -m "feat: add simulated legacy auth backend with service-token guard"
```

---

## Task 6: Credential dispatch and sessions

**Files:**
- Create: `lib/auth/verify.ts`, `lib/auth/session.ts`
- Test: `test/verify.test.ts`, `test/session.test.ts`

**Interfaces:**
- Consumes: `customers`, `sessions` (Task 2), `verifyPassword` / `dummyVerify` (Task 4), `verifyLegacyCredential` (Task 5).
- Produces:
  - `verifyCredentials(email: string, password: string): Promise<{ ok: boolean; customerId?: number }>`
  - `createSession(customerId: number, userAgent?: string): Promise<string>` — returns the raw cookie value
  - `resolveSession(token: string): Promise<Customer | null>` — null when missing, expired, or revoked
  - `revokeSession(token: string): Promise<void>`
  - `getCurrentCustomer(): Promise<Customer | null>` — React-`cache()`-wrapped, reads the `nb_session` cookie
  - `requireCustomer(): Promise<Customer>` — redirects to `/login` when absent
  - `SESSION_COOKIE = 'nb_session'`, `SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14`

- [ ] **Step 1: Write the failing dispatch test**

```ts
// test/verify.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { withTestDb, seedMinimal, type TestDb } from './harness';

let tdb: TestDb;
vi.mock('@/db/client', () => ({ get db() { return (globalThis as any).__testDb; } }));

beforeEach(async () => {
  tdb = await withTestDb();
  await seedMinimal(tdb);
  (globalThis as any).__testDb = tdb.db;
  process.env.LEGACY_AUTH_SERVICE_TOKEN = 'test-token';
});
afterEach(async () => { await tdb.close(); });

describe('verifyCredentials', () => {
  it('authenticates Alice against the local password hash', async () => {
    const { verifyCredentials } = await import('@/lib/auth/verify');
    expect(await verifyCredentials('alice@example.com', 'password123'))
      .toEqual({ ok: true, customerId: 82731 });
  });

  it('authenticates Carol against the local password hash', async () => {
    const { verifyCredentials } = await import('@/lib/auth/verify');
    expect(await verifyCredentials('carol@example.com', 'password123'))
      .toEqual({ ok: true, customerId: 44102 });
  });

  // Bob's credential is NOT in customers.password_hash. It is resolved by
  // delegating to the simulated legacy backend.
  it('authenticates Bob by delegating to the legacy backend', async () => {
    const { verifyCredentials } = await import('@/lib/auth/verify');
    expect(await verifyCredentials('bob@example.com', 'legacy-pass-2019'))
      .toEqual({ ok: true, customerId: 19382 });
  });

  it('rejects Bob with the wrong legacy password', async () => {
    const { verifyCredentials } = await import('@/lib/auth/verify');
    expect(await verifyCredentials('bob@example.com', 'password123')).toEqual({ ok: false });
  });

  it('returns the same failure shape for an unknown email', async () => {
    const { verifyCredentials } = await import('@/lib/auth/verify');
    expect(await verifyCredentials('nobody@example.com', 'whatever')).toEqual({ ok: false });
  });

  it('is case-insensitive on email', async () => {
    const { verifyCredentials } = await import('@/lib/auth/verify');
    expect(await verifyCredentials('ALICE@Example.com', 'password123'))
      .toEqual({ ok: true, customerId: 82731 });
  });

  it('does not leave Bob a local password hash after a successful login', async () => {
    const { verifyCredentials } = await import('@/lib/auth/verify');
    await verifyCredentials('bob@example.com', 'legacy-pass-2019');
    const { eq } = await import('drizzle-orm');
    const schema = await import('@/db/schema');
    const [bob] = await tdb.db.select().from(schema.customers)
      .where(eq(schema.customers.id, 19382));
    expect(bob.passwordHash).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm test test/verify.test.ts` → Expected: FAIL — cannot resolve `@/lib/auth/verify`.

- [ ] **Step 3: Write `lib/auth/verify.ts`**

```ts
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { customers } from '@/db/schema';
import { verifyPassword, dummyVerify } from './password';
import { verifyLegacyCredential } from '@/app/legacy-auth/verify/route';

export type VerifyResult = { ok: boolean; customerId?: number };

/**
 * SECURITY BOUNDARY — where the customer's credential is entered and checked.
 *
 * The caller passes a plaintext password that came from Northbound's own login
 * form. Depending on which backend owns the account, this function either
 * verifies it locally or hands it to the legacy service. In neither case does
 * the credential leave the server, and in neither case does a caller learn
 * WHICH backend answered — both branches return the identical shape.
 *
 * Sub-project C's authorization experience calls this same function. That is
 * deliberate: it is genuine shared authentication logic, not agent scaffolding.
 * The agent never calls it and never sees its input.
 */
export async function verifyCredentials(email: string, password: string): Promise<VerifyResult> {
  const normalized = email.trim().toLowerCase();

  const [customer] = await db.select().from(customers)
    .where(eq(customers.email, normalized)).limit(1);

  // Constant-work path so response timing does not enumerate accounts.
  if (!customer) { await dummyVerify(password); return { ok: false }; }

  if (customer.authBackend === 'legacy') {
    // The credential is owned by a system we do not control. We forward it;
    // we never copy it into customers.password_hash.
    const result = await verifyLegacyCredential(normalized, password);
    return result.ok ? { ok: true, customerId: customer.id } : { ok: false };
  }

  if (!customer.passwordHash) { await dummyVerify(password); return { ok: false }; }

  const ok = await verifyPassword(password, customer.passwordHash);
  return ok ? { ok: true, customerId: customer.id } : { ok: false };
}
```

- [ ] **Step 4: Run the dispatch test**

Run: `pnpm test test/verify.test.ts` → Expected: PASS (7 tests).

- [ ] **Step 5: Write the failing session test**

This covers **Review Focus item 4** — expired and revoked sessions must fail closed.

```ts
// test/session.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { withTestDb, seedMinimal, type TestDb } from './harness';

let tdb: TestDb;
vi.mock('@/db/client', () => ({ get db() { return (globalThis as any).__testDb; } }));

beforeEach(async () => {
  tdb = await withTestDb();
  await seedMinimal(tdb);
  (globalThis as any).__testDb = tdb.db;
});
afterEach(async () => { await tdb.close(); });

describe('sessions', () => {
  it('creates an opaque token and resolves it to the customer', async () => {
    const { createSession, resolveSession } = await import('@/lib/auth/session');
    const token = await createSession(82731);
    const customer = await resolveSession(token);
    expect(customer?.id).toBe(82731);
  });

  // SECURITY: the cookie value must not be a JWT or carry any claims.
  it('issues a token that is 64 hex characters and carries no structure', async () => {
    const { createSession } = await import('@/lib/auth/session');
    const token = await createSession(82731);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(token).not.toContain('.');
    expect(() => JSON.parse(Buffer.from(token.split('.')[0], 'base64').toString())).toThrow();
  });

  it('issues a different token every time', async () => {
    const { createSession } = await import('@/lib/auth/session');
    expect(await createSession(82731)).not.toBe(await createSession(82731));
  });

  it('returns null for a token that was never issued', async () => {
    const { resolveSession } = await import('@/lib/auth/session');
    expect(await resolveSession('0'.repeat(64))).toBeNull();
  });

  // REVIEW FOCUS 4: expired sessions fail closed.
  it('returns null for an expired session rather than the customer', async () => {
    const { createSession, resolveSession } = await import('@/lib/auth/session');
    const token = await createSession(82731);
    await tdb.db.update(schema.sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.sessions.id, token));
    expect(await resolveSession(token)).toBeNull();
  });

  // REVIEW FOCUS 4: revoked sessions fail closed.
  it('returns null for a revoked session', async () => {
    const { createSession, resolveSession, revokeSession } = await import('@/lib/auth/session');
    const token = await createSession(82731);
    await revokeSession(token);
    expect(await resolveSession(token)).toBeNull();
  });

  it('revoking is idempotent and does not throw on an unknown token', async () => {
    const { revokeSession } = await import('@/lib/auth/session');
    await expect(revokeSession('f'.repeat(64))).resolves.toBeUndefined();
  });

  it('does not throw on a malformed token', async () => {
    const { resolveSession } = await import('@/lib/auth/session');
    expect(await resolveSession('')).toBeNull();
    expect(await resolveSession('not-a-token')).toBeNull();
  });

  it('advances last_seen_at when a session resolves', async () => {
    const { createSession, resolveSession } = await import('@/lib/auth/session');
    const token = await createSession(82731);
    await tdb.db.update(schema.sessions)
      .set({ lastSeenAt: new Date(Date.now() - 60_000) })
      .where(eq(schema.sessions.id, token));
    await resolveSession(token);
    const [row] = await tdb.db.select().from(schema.sessions)
      .where(eq(schema.sessions.id, token));
    expect(row.lastSeenAt.getTime()).toBeGreaterThan(Date.now() - 5_000);
  });
});
```

- [ ] **Step 6: Run it and confirm it fails**

Run: `pnpm test test/session.test.ts` → Expected: FAIL — cannot resolve `@/lib/auth/session`.

- [ ] **Step 7: Write `lib/auth/session.ts`**

```ts
import { randomBytes } from 'node:crypto';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/db/client';
import { customers, sessions, type Customer } from '@/db/schema';

export const SESSION_COOKIE = 'nb_session';
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

/**
 * SECURITY BOUNDARY — why this token is opaque.
 *
 * The value below is 32 random bytes. It carries no claims, no signature, and
 * no meaning outside the `sessions` table.
 *
 * This is a STRUCTURAL answer to the project's hard requirement that the agent
 * API must never accept a browser session. A JWT session cookie would be
 * SHAPED like a bearer token, and the only thing preventing it being presented
 * to /api/* would be a check that a future contributor might not preserve. An
 * opaque database token cannot be validated as an access token by any code
 * path, including code written by someone who never read the test.
 */
export async function createSession(customerId: number, userAgent?: string): Promise<string> {
  const token = randomBytes(32).toString('hex');
  const now = new Date();
  await db.insert(sessions).values({
    id: token,
    customerId,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
    revokedAt: null,
    userAgent: userAgent ?? null,
  });
  return token;
}

/** Fails closed: missing, expired, or revoked all resolve to null. */
export async function resolveSession(token: string): Promise<Customer | null> {
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;

  const [row] = await db.select({ session: sessions, customer: customers })
    .from(sessions)
    .innerJoin(customers, eq(sessions.customerId, customers.id))
    .where(and(eq(sessions.id, token), isNull(sessions.revokedAt)))
    .limit(1);

  if (!row) return null;
  if (row.session.expiresAt.getTime() <= Date.now()) return null;

  await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, token));
  return row.customer;
}

export async function revokeSession(token: string): Promise<void> {
  if (!token) return;
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, token));
}

/**
 * Per-request memoized. NOT Next.js middleware: middleware runs on the edge
 * runtime and cannot open a SQLite handle, so session validation happens here,
 * in server components and route handlers.
 */
export const getCurrentCustomer = cache(async (): Promise<Customer | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  return token ? resolveSession(token) : null;
});

export async function requireCustomer(): Promise<Customer> {
  const customer = await getCurrentCustomer();
  if (!customer) redirect('/login');
  return customer;
}
```

- [ ] **Step 8: Run the full suite**

Run: `pnpm test`
Expected: PASS — smoke (1), schema (3), harness (4), money (6), password (5), legacy-auth (7), verify (7), session (9).

- [ ] **Step 9: Commit**

```bash
git add lib/auth/verify.ts lib/auth/session.ts test/verify.test.ts test/session.test.ts
git commit -m "feat: add credential dispatch and opaque database-backed sessions"
```

---

## Task 7: Catalog seed data and product imagery

**Files:**
- Create: `db/seed/images.ts`, `db/seed/catalog.ts`, `scripts/fetch-images.ts`
- Create: `public/products/CREDITS.md`
- Test: `test/catalog-seed.test.ts`

**Interfaces:**
- Consumes: `categories`, `products` (Task 2).
- Produces:
  - `CATEGORIES: { slug, name, description, sortOrder }[]` — exactly 8
  - `PRODUCTS: { sku, slug, name, description, categorySlug, priceCents, photoId, stockQty }[]` — exactly 64
  - `seedCatalog(db): Promise<void>`
  - `public/products/<slug>.webp` — 64 committed images

Note on imagery: `source.unsplash.com` was retired and returns 503. The `images.unsplash.com` CDN serves pinned photo IDs with no API key, which is what this task uses.

- [ ] **Step 1: Write `db/seed/images.ts`**

Pin one Unsplash photo ID per SKU. IDs below are verified-resolving; source additional ones the same way (load an Unsplash search page and read `images.unsplash.com/photo-…` from the `img` elements).

```ts
/**
 * Pinned Unsplash photo IDs, one per SKU, keyed by product slug.
 *
 * `source.unsplash.com` was retired and now returns 503. These IDs are fetched
 * from the images.unsplash.com CDN by `pnpm images:fetch`, converted to WebP,
 * and COMMITTED to public/products/. A cold clone therefore demos correctly
 * with no network access and no rate limit.
 *
 * Attribution for every photo is recorded in public/products/CREDITS.md.
 */
export const PHOTO_IDS: Record<string, string> = {
  'cascade-45l-expedition-pack': 'photo-1551632811-561732d1e306',
  'summit-gtx-hiking-boot':      'photo-1530792271526-7ddf516473b3',
  'aurora-2p-tent':              'photo-1504280390367-361c6d9f38f4',
  'ridgeline-3l-hardshell':      'photo-1516648064-ee10acfa64db',
  'traverse-daypack-22l':        'photo-1501555088652-021faa106b9b',
  'moraine-trail-runner':        'photo-1575987116913-e96e7d490b8a',
  'basin-hammock':               'photo-1510312305653-8ed496efae75',
  'tundra-down-parka':           'photo-1557479613-9f88c8450c5d',
  // ... 56 more, one per SKU in db/seed/catalog.ts
};
```

- [ ] **Step 2: Write `db/seed/catalog.ts`**

Eight categories; eight products each, priced within the band recorded in the spec. Full shape shown; repeat the product literal for all 64.

```ts
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from '@/db/schema';

export const CATEGORIES = [
  { slug: 'outerwear',    name: 'Outerwear',             description: 'Shells, insulation, and everything between you and the weather.', sortOrder: 1 },
  { slug: 'footwear',     name: 'Footwear',              description: 'Boots and trail runners built for distance.',                     sortOrder: 2 },
  { slug: 'packs-bags',   name: 'Packs & Bags',          description: 'Carry systems from summit packs to expedition haulers.',          sortOrder: 3 },
  { slug: 'shelter-sleep',name: 'Shelter & Sleep',       description: 'Tents, bags, and pads for a night that counts.',                  sortOrder: 4 },
  { slug: 'base-layers',  name: 'Base Layers & Apparel', description: 'Merino and synthetics that work wet.',                            sortOrder: 5 },
  { slug: 'camp-kitchen', name: 'Camp Kitchen',          description: 'Stoves, cookware, and water treatment.',                          sortOrder: 6 },
  { slug: 'navigation',   name: 'Navigation & Light',    description: 'Headlamps, compasses, and satellite messengers.',                 sortOrder: 7 },
  { slug: 'accessories',  name: 'Accessories',           description: 'Gloves, poles, gaiters, and first aid.',                          sortOrder: 8 },
] as const;

export type SeedProduct = {
  sku: string; slug: string; name: string; description: string;
  categorySlug: (typeof CATEGORIES)[number]['slug'];
  priceCents: number; stockQty: number;
};

export const PRODUCTS: SeedProduct[] = [
  { sku: 'NB-OW-001', slug: 'ridgeline-3l-hardshell', name: 'Ridgeline 3L Hardshell',
    description: 'A three-layer waterproof shell with taped seams and a helmet-compatible hood. Cut long at the back for pack wear.',
    categorySlug: 'outerwear', priceCents: 48000, stockQty: 24 },
  { sku: 'NB-OW-002', slug: 'tundra-down-parka', name: 'Tundra 800-Fill Down Parka',
    description: 'Responsibly sourced 800-fill down under a recycled ripstop face. Packs to the size of a loaf of bread.',
    categorySlug: 'outerwear', priceCents: 65000, stockQty: 12 },
  // ... 6 more Outerwear, then 8 per remaining category.
  //
  // PRICE BANDS — every product must fall inside its category's band:
  //   outerwear      $120–650      base-layers    $28–175
  //   footwear        $95–280      camp-kitchen   $18–210
  //   packs-bags      $45–420      navigation     $24–380
  //   shelter-sleep   $85–850      accessories    $16–195
  //
  // At least one product in each of outerwear, shelter-sleep and packs-bags
  // must exceed $40000 cents so a two-item basket can reach the $900 used in
  // the project's approval demo.
];

export async function seedCatalog(db: LibSQLDatabase<typeof schema>): Promise<void> {
  const now = new Date();
  const inserted = await db.insert(schema.categories)
    .values(CATEGORIES.map((c) => ({ ...c }))).returning();
  const idBySlug = new Map(inserted.map((c) => [c.slug, c.id]));

  await db.insert(schema.products).values(PRODUCTS.map((p) => ({
    sku: p.sku, slug: p.slug, name: p.name, description: p.description,
    categoryId: idBySlug.get(p.categorySlug)!,
    priceCents: p.priceCents,
    imagePath: `/products/${p.slug}.webp`,
    stockQty: p.stockQty, isActive: true, createdAt: now,
  })));
}
```

- [ ] **Step 3: Write `scripts/fetch-images.ts`**

```ts
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import sharp from 'sharp';
import { PHOTO_IDS } from '../db/seed/images';

const OUT = 'public/products';
mkdirSync(OUT, { recursive: true });

let fetched = 0, skipped = 0;
for (const [slug, photoId] of Object.entries(PHOTO_IDS)) {
  const dest = `${OUT}/${slug}.webp`;
  if (existsSync(dest)) { skipped++; continue; }

  const url = `https://images.unsplash.com/${photoId}?w=1200&q=85&fm=jpg&fit=crop`;
  const res = await fetch(url);
  if (!res.ok) { console.error(`FAIL ${slug}: ${res.status} ${url}`); process.exitCode = 1; continue; }

  const webp = await sharp(Buffer.from(await res.arrayBuffer()))
    .resize(800, 600, { fit: 'cover' }).webp({ quality: 82 }).toBuffer();
  writeFileSync(dest, webp);
  fetched++;
  console.log(`ok   ${slug} (${Math.round(webp.length / 1024)}kB)`);
}
console.log(`\nfetched ${fetched}, skipped ${skipped} already present`);
```

- [ ] **Step 4: Fetch the images and write credits**

```bash
pnpm images:fetch
```

Expected: 64 `.webp` files in `public/products/`, each roughly 40–90kB, total 3–5MB. Any `FAIL` line means that photo ID no longer resolves — replace it in `db/seed/images.ts` and re-run.

Write `public/products/CREDITS.md` listing each file, its Unsplash photo ID, and its `https://unsplash.com/photos/<id>` URL.

- [ ] **Step 5: Write the catalog seed test**

```ts
// test/catalog-seed.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import * as schema from '@/db/schema';
import { withTestDb, type TestDb } from './harness';
import { CATEGORIES, PRODUCTS, seedCatalog } from '@/db/seed/catalog';
import { PHOTO_IDS } from '@/db/seed/images';

const BANDS: Record<string, [number, number]> = {
  'outerwear': [12000, 65000], 'footwear': [9500, 28000],
  'packs-bags': [4500, 42000], 'shelter-sleep': [8500, 85000],
  'base-layers': [2800, 17500], 'camp-kitchen': [1800, 21000],
  'navigation': [2400, 38000], 'accessories': [1600, 19500],
};

describe('catalog seed data', () => {
  it('defines exactly 8 categories', () => { expect(CATEGORIES).toHaveLength(8); });
  it('defines exactly 64 products', () => { expect(PRODUCTS).toHaveLength(64); });
  it('puts 8 products in every category', () => {
    for (const c of CATEGORIES) {
      expect(PRODUCTS.filter((p) => p.categorySlug === c.slug)).toHaveLength(8);
    }
  });
  it('uses unique SKUs and slugs', () => {
    expect(new Set(PRODUCTS.map((p) => p.sku)).size).toBe(64);
    expect(new Set(PRODUCTS.map((p) => p.slug)).size).toBe(64);
  });
  it('prices every product inside its category band', () => {
    for (const p of PRODUCTS) {
      const [min, max] = BANDS[p.categorySlug];
      expect(p.priceCents, `${p.slug}`).toBeGreaterThanOrEqual(min);
      expect(p.priceCents, `${p.slug}`).toBeLessThanOrEqual(max);
    }
  });
  it('can build a basket of two items reaching $900', () => {
    const top = PRODUCTS.map((p) => p.priceCents).sort((a, b) => b - a);
    expect(top[0] + top[1]).toBeGreaterThanOrEqual(90000);
  });
  it('pins a photo id for every product', () => {
    for (const p of PRODUCTS) expect(PHOTO_IDS, p.slug).toHaveProperty(p.slug);
  });
  it('has a committed image file for every product', () => {
    for (const p of PRODUCTS) {
      expect(existsSync(`public/products/${p.slug}.webp`), p.slug).toBe(true);
    }
  });

  describe('seedCatalog', () => {
    let tdb: TestDb;
    beforeEach(async () => { tdb = await withTestDb(); });
    afterEach(async () => { await tdb.close(); });

    it('inserts all categories and products with resolved image paths', async () => {
      await seedCatalog(tdb.db);
      expect(await tdb.db.select().from(schema.categories)).toHaveLength(8);
      const products = await tdb.db.select().from(schema.products);
      expect(products).toHaveLength(64);
      expect(products.every((p) => p.imagePath.startsWith('/products/'))).toBe(true);
      expect(products.every((p) => p.categoryId > 0)).toBe(true);
    });
  });
});
```

- [ ] **Step 6: Run and commit**

Run: `pnpm test test/catalog-seed.test.ts` → Expected: PASS (9 tests).

```bash
git add db/seed scripts/fetch-images.ts public/products test/catalog-seed.test.ts
git commit -m "feat: add 64-SKU outdoor catalog seed with committed product imagery"
```

---

## Task 8: Service errors, catalog service, cart service

**Files:**
- Create: `lib/services/errors.ts`, `lib/services/catalog.ts`, `lib/services/cart.ts`
- Test: `test/services-catalog.test.ts`, `test/services-cart.test.ts`

**Interfaces:**
- Consumes: schema (Task 2), harness (Task 3), `formatCents` (Task 4).
- Produces:
  - `NotFoundError`, `OwnershipError`, `OutOfStockError`, `ValidationError`, `PriceChangedError` — all extending `ServiceError` with a `.code` string
  - `listCategories(): Promise<Category[]>`
  - `searchProducts(filters): Promise<{ items: Product[]; total: number }>` where `filters = { q?, categorySlug?, minCents?, maxCents?, sort?: 'featured'|'price-asc'|'price-desc'|'name', page?, perPage? }`
  - `getProductBySlug(slug: string): Promise<Product>` — throws `NotFoundError`
  - `getCart(customerId): Promise<CartView>` where `CartView = { items: CartLine[]; subtotalCents; shippingCents; taxCents; totalCents }` and `CartLine = { productId; slug; name; imagePath; unitPriceCents; quantity; lineTotalCents; stockQty; isActive }`
  - `addToCart(customerId, productId, quantity): Promise<void>`
  - `updateCartItem(customerId, productId, quantity): Promise<void>` — quantity 0 removes
  - `removeFromCart(customerId, productId): Promise<void>`
  - `clearCart(customerId): Promise<void>`

- [ ] **Step 1: Write `lib/services/errors.ts`**

```ts
/**
 * Services throw these. They never return HTTP concepts.
 *
 * The storefront maps them to form errors. Sub-project B maps the same classes
 * to status codes on the agent API. Keeping transport out of the service layer
 * is what lets both surfaces share one implementation.
 */
export abstract class ServiceError extends Error {
  abstract readonly code: string;
}

export class NotFoundError extends ServiceError {
  readonly code = 'not_found';
  constructor(what: string) { super(`${what} not found`); }
}

/** Raised when a customer references a row belonging to someone else. */
export class OwnershipError extends ServiceError {
  readonly code = 'forbidden';
  constructor(what: string) { super(`${what} does not belong to this customer`); }
}

export class OutOfStockError extends ServiceError {
  readonly code = 'out_of_stock';
  constructor(public readonly productName: string, public readonly available: number) {
    super(`${productName} is out of stock (${available} remaining)`);
  }
}

export class ValidationError extends ServiceError {
  readonly code = 'invalid';
  constructor(message: string) { super(message); }
}

/** The basket total moved between display and checkout. */
export class PriceChangedError extends ServiceError {
  readonly code = 'price_changed';
  constructor(public readonly expectedCents: number, public readonly actualCents: number) {
    super(`Price changed: expected ${expectedCents}, now ${actualCents}`);
  }
}
```

- [ ] **Step 2: Write the failing catalog service test**

```ts
// test/services-catalog.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { withTestDb, seedMinimal, type TestDb } from './harness';

let tdb: TestDb;
vi.mock('@/db/client', () => ({ get db() { return (globalThis as any).__testDb; } }));

beforeEach(async () => {
  tdb = await withTestDb();
  await seedMinimal(tdb);
  (globalThis as any).__testDb = tdb.db;
});
afterEach(async () => { await tdb.close(); });

describe('catalog service', () => {
  it('lists categories in sort order', async () => {
    const { listCategories } = await import('@/lib/services/catalog');
    const cats = await listCategories();
    expect(cats.length).toBeGreaterThan(0);
  });

  it('returns a product by slug', async () => {
    const { getProductBySlug } = await import('@/lib/services/catalog');
    const p = await getProductBySlug('cascade-45l');
    expect(p.name).toBe('Cascade 45L Expedition Pack');
  });

  it('throws NotFoundError for an unknown slug', async () => {
    const { getProductBySlug } = await import('@/lib/services/catalog');
    const { NotFoundError } = await import('@/lib/services/errors');
    await expect(getProductBySlug('no-such-product')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('searches by free text, case-insensitively', async () => {
    const { searchProducts } = await import('@/lib/services/catalog');
    const { items } = await searchProducts({ q: 'CASCADE' });
    expect(items.map((p) => p.slug)).toEqual(['cascade-45l']);
  });

  it('filters by price range', async () => {
    const { searchProducts } = await import('@/lib/services/catalog');
    const { items } = await searchProducts({ maxCents: 2000 });
    expect(items.map((p) => p.slug)).toEqual(['trail-mug']);
  });

  it('sorts by price ascending and descending', async () => {
    const { searchProducts } = await import('@/lib/services/catalog');
    const asc = await searchProducts({ sort: 'price-asc' });
    const desc = await searchProducts({ sort: 'price-desc' });
    expect(asc.items[0].slug).toBe('trail-mug');
    expect(desc.items[0].slug).toBe('ridgeline-shell');
  });

  it('excludes inactive products', async () => {
    const schema = await import('@/db/schema');
    const { eq } = await import('drizzle-orm');
    await tdb.db.update(schema.products).set({ isActive: false })
      .where(eq(schema.products.slug, 'trail-mug'));
    const { searchProducts } = await import('@/lib/services/catalog');
    const { items } = await searchProducts({});
    expect(items.map((p) => p.slug)).not.toContain('trail-mug');
  });

  it('paginates and reports the unpaginated total', async () => {
    const { searchProducts } = await import('@/lib/services/catalog');
    const page1 = await searchProducts({ perPage: 2, page: 1 });
    expect(page1.items).toHaveLength(2);
    expect(page1.total).toBe(3);
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `pnpm test test/services-catalog.test.ts` → Expected: FAIL — cannot resolve `@/lib/services/catalog`.

- [ ] **Step 4: Write `lib/services/catalog.ts`**

```ts
import { and, asc, desc, eq, gte, like, lte, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { categories, products, type Category, type Product } from '@/db/schema';
import { NotFoundError } from './errors';

export async function listCategories(): Promise<Category[]> {
  return db.select().from(categories).orderBy(asc(categories.sortOrder));
}

export async function getProductBySlug(slug: string): Promise<Product> {
  const [p] = await db.select().from(products)
    .where(and(eq(products.slug, slug), eq(products.isActive, true))).limit(1);
  if (!p) throw new NotFoundError('Product');
  return p;
}

const FiltersSchema = z.object({
  q: z.string().trim().max(200).optional(),
  categorySlug: z.string().max(100).optional(),
  minCents: z.number().int().nonnegative().optional(),
  maxCents: z.number().int().nonnegative().optional(),
  sort: z.enum(['featured', 'price-asc', 'price-desc', 'name']).default('featured'),
  page: z.number().int().positive().default(1),
  perPage: z.number().int().positive().max(100).default(24),
});
export type ProductFilters = z.input<typeof FiltersSchema>;

export async function searchProducts(
  raw: ProductFilters,
): Promise<{ items: Product[]; total: number }> {
  const f = FiltersSchema.parse(raw);
  const clauses: SQL[] = [eq(products.isActive, true)];

  if (f.q) clauses.push(like(sql`lower(${products.name})`, `%${f.q.toLowerCase()}%`));
  if (f.minCents !== undefined) clauses.push(gte(products.priceCents, f.minCents));
  if (f.maxCents !== undefined) clauses.push(lte(products.priceCents, f.maxCents));

  if (f.categorySlug) {
    const [cat] = await db.select().from(categories)
      .where(eq(categories.slug, f.categorySlug)).limit(1);
    if (!cat) return { items: [], total: 0 };
    clauses.push(eq(products.categoryId, cat.id));
  }

  const where = and(...clauses);
  const order =
    f.sort === 'price-asc'  ? asc(products.priceCents)  :
    f.sort === 'price-desc' ? desc(products.priceCents) :
    f.sort === 'name'       ? asc(products.name)        : asc(products.id);

  const [{ count }] = await db.select({ count: sql<number>`count(*)` })
    .from(products).where(where);

  const items = await db.select().from(products)
    .where(where).orderBy(order)
    .limit(f.perPage).offset((f.page - 1) * f.perPage);

  return { items, total: Number(count) };
}
```

- [ ] **Step 5: Run the catalog test**

Run: `pnpm test test/services-catalog.test.ts` → Expected: PASS (8 tests).

- [ ] **Step 6: Write the failing cart test**

This covers **Review Focus item 5** — quantity validation at the service boundary.

```ts
// test/services-cart.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { withTestDb, seedMinimal, type TestDb } from './harness';

let tdb: TestDb;
let ids: Awaited<ReturnType<typeof seedMinimal>>;
vi.mock('@/db/client', () => ({ get db() { return (globalThis as any).__testDb; } }));

beforeEach(async () => {
  tdb = await withTestDb();
  ids = await seedMinimal(tdb);
  (globalThis as any).__testDb = tdb.db;
});
afterEach(async () => { await tdb.close(); });

const pack = () => ids.productIds[0];   // $420.00, stock 10
const mug  = () => ids.productIds[2];   // $18.00,  stock 50

describe('cart service', () => {
  it('starts empty with shipping applied and no tax', async () => {
    const { getCart } = await import('@/lib/services/cart');
    const cart = await getCart(ids.alice);
    expect(cart.items).toEqual([]);
    expect(cart.totalCents).toBe(895);
  });

  it('adds an item and computes the line total from live price', async () => {
    const { addToCart, getCart } = await import('@/lib/services/cart');
    await addToCart(ids.alice, pack(), 2);
    const cart = await getCart(ids.alice);
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0].lineTotalCents).toBe(84000);
    expect(cart.subtotalCents).toBe(84000);
    expect(cart.shippingCents).toBe(0);      // over the free threshold
    expect(cart.taxCents).toBe(7140);
    expect(cart.totalCents).toBe(91140);
  });

  it('accumulates quantity when the same product is added twice', async () => {
    const { addToCart, getCart } = await import('@/lib/services/cart');
    await addToCart(ids.alice, mug(), 2);
    await addToCart(ids.alice, mug(), 3);
    const cart = await getCart(ids.alice);
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0].quantity).toBe(5);
  });

  // REVIEW FOCUS 5: quantity validation.
  it('rejects a zero quantity on add', async () => {
    const { addToCart } = await import('@/lib/services/cart');
    const { ValidationError } = await import('@/lib/services/errors');
    await expect(addToCart(ids.alice, mug(), 0)).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a negative quantity', async () => {
    const { addToCart } = await import('@/lib/services/cart');
    const { ValidationError } = await import('@/lib/services/errors');
    await expect(addToCart(ids.alice, mug(), -3)).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a fractional quantity', async () => {
    const { addToCart } = await import('@/lib/services/cart');
    const { ValidationError } = await import('@/lib/services/errors');
    await expect(addToCart(ids.alice, mug(), 2.5)).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects an absurd quantity', async () => {
    const { addToCart } = await import('@/lib/services/cart');
    const { ValidationError } = await import('@/lib/services/errors');
    await expect(addToCart(ids.alice, mug(), 999_999)).rejects.toBeInstanceOf(ValidationError);
  });

  it('refuses to add more than remaining stock', async () => {
    const { addToCart } = await import('@/lib/services/cart');
    const { OutOfStockError } = await import('@/lib/services/errors');
    await expect(addToCart(ids.alice, ids.productIds[1], 5))
      .rejects.toBeInstanceOf(OutOfStockError);   // ridgeline-shell has stock 1
  });

  it('throws NotFoundError for an unknown product', async () => {
    const { addToCart } = await import('@/lib/services/cart');
    const { NotFoundError } = await import('@/lib/services/errors');
    await expect(addToCart(ids.alice, 999_999, 1)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('removes a line when quantity is set to zero', async () => {
    const { addToCart, updateCartItem, getCart } = await import('@/lib/services/cart');
    await addToCart(ids.alice, mug(), 3);
    await updateCartItem(ids.alice, mug(), 0);
    expect((await getCart(ids.alice)).items).toEqual([]);
  });

  it('removes a line explicitly', async () => {
    const { addToCart, removeFromCart, getCart } = await import('@/lib/services/cart');
    await addToCart(ids.alice, mug(), 3);
    await removeFromCart(ids.alice, mug());
    expect((await getCart(ids.alice)).items).toEqual([]);
  });

  // OWNERSHIP: the ancestor of every authorization test in this repository.
  it('keeps carts isolated between customers', async () => {
    const { addToCart, getCart } = await import('@/lib/services/cart');
    await addToCart(ids.alice, pack(), 1);
    expect((await getCart(ids.carol)).items).toEqual([]);
  });

  it('does not let one customer remove another customer\'s line', async () => {
    const { addToCart, removeFromCart, getCart } = await import('@/lib/services/cart');
    await addToCart(ids.alice, pack(), 1);
    await removeFromCart(ids.carol, pack());
    expect((await getCart(ids.alice)).items).toHaveLength(1);
  });
});
```

- [ ] **Step 7: Run it and confirm it fails**

Run: `pnpm test test/services-cart.test.ts` → Expected: FAIL — cannot resolve `@/lib/services/cart`.

- [ ] **Step 8: Write `lib/services/cart.ts`**

```ts
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { carts, cartItems, products } from '@/db/schema';
import { calcTotals } from '@/lib/money';
import { NotFoundError, OutOfStockError, ValidationError } from './errors';

export type CartLine = {
  productId: number; slug: string; name: string; imagePath: string;
  unitPriceCents: number; quantity: number; lineTotalCents: number;
  stockQty: number; isActive: boolean;
};

export type CartView = {
  items: CartLine[];
  subtotalCents: number; shippingCents: number; taxCents: number; totalCents: number;
};

const MAX_QTY_PER_LINE = 99;

// Zod at the SERVICE boundary, not in the server action — otherwise sub-project
// B's API callers would get no validation at all.
const QuantitySchema = z.number().int()
  .positive('Quantity must be at least 1')
  .max(MAX_QTY_PER_LINE, `Quantity may not exceed ${MAX_QTY_PER_LINE}`);

async function getOrCreateCart(customerId: number) {
  const [existing] = await db.select().from(carts)
    .where(eq(carts.customerId, customerId)).limit(1);
  if (existing) return existing;

  const now = new Date();
  const [created] = await db.insert(carts)
    .values({ customerId, createdAt: now, updatedAt: now }).returning();
  return created;
}

export async function getCart(customerId: number): Promise<CartView> {
  const cart = await getOrCreateCart(customerId);

  const rows = await db.select({ item: cartItems, product: products })
    .from(cartItems)
    .innerJoin(products, eq(cartItems.productId, products.id))
    .where(eq(cartItems.cartId, cart.id));

  const items: CartLine[] = rows.map(({ item, product }) => ({
    productId: product.id, slug: product.slug, name: product.name,
    imagePath: product.imagePath, unitPriceCents: product.priceCents,
    quantity: item.quantity, lineTotalCents: product.priceCents * item.quantity,
    stockQty: product.stockQty, isActive: product.isActive,
  }));

  const subtotal = items.reduce((sum, i) => sum + i.lineTotalCents, 0);
  return { items, ...calcTotals(subtotal) };
}

export async function addToCart(
  customerId: number, productId: number, quantity: number,
): Promise<void> {
  const parsed = QuantitySchema.safeParse(quantity);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0].message);

  const [product] = await db.select().from(products)
    .where(and(eq(products.id, productId), eq(products.isActive, true))).limit(1);
  if (!product) throw new NotFoundError('Product');

  const cart = await getOrCreateCart(customerId);
  const [existing] = await db.select().from(cartItems)
    .where(and(eq(cartItems.cartId, cart.id), eq(cartItems.productId, productId))).limit(1);

  const desired = (existing?.quantity ?? 0) + parsed.data;
  if (desired > product.stockQty) throw new OutOfStockError(product.name, product.stockQty);
  if (desired > MAX_QTY_PER_LINE) {
    throw new ValidationError(`Quantity may not exceed ${MAX_QTY_PER_LINE}`);
  }

  if (existing) {
    await db.update(cartItems).set({ quantity: desired }).where(eq(cartItems.id, existing.id));
  } else {
    await db.insert(cartItems).values({ cartId: cart.id, productId, quantity: desired });
  }
  await db.update(carts).set({ updatedAt: new Date() }).where(eq(carts.id, cart.id));
}

export async function updateCartItem(
  customerId: number, productId: number, quantity: number,
): Promise<void> {
  if (quantity === 0) return removeFromCart(customerId, productId);

  const parsed = QuantitySchema.safeParse(quantity);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0].message);

  const [product] = await db.select().from(products)
    .where(eq(products.id, productId)).limit(1);
  if (!product) throw new NotFoundError('Product');
  if (parsed.data > product.stockQty) throw new OutOfStockError(product.name, product.stockQty);

  const cart = await getOrCreateCart(customerId);
  await db.update(cartItems).set({ quantity: parsed.data })
    .where(and(eq(cartItems.cartId, cart.id), eq(cartItems.productId, productId)));
  await db.update(carts).set({ updatedAt: new Date() }).where(eq(carts.id, cart.id));
}

export async function removeFromCart(customerId: number, productId: number): Promise<void> {
  const cart = await getOrCreateCart(customerId);
  await db.delete(cartItems)
    .where(and(eq(cartItems.cartId, cart.id), eq(cartItems.productId, productId)));
  await db.update(carts).set({ updatedAt: new Date() }).where(eq(carts.id, cart.id));
}

export async function clearCart(customerId: number): Promise<void> {
  const cart = await getOrCreateCart(customerId);
  await db.delete(cartItems).where(eq(cartItems.cartId, cart.id));
  await db.update(carts).set({ updatedAt: new Date() }).where(eq(carts.id, cart.id));
}
```

- [ ] **Step 9: Run and commit**

Run: `pnpm test test/services-cart.test.ts` → Expected: PASS (13 tests).
Run: `pnpm test` → Expected: all suites PASS.

```bash
git add lib/services test/services-catalog.test.ts test/services-cart.test.ts
git commit -m "feat: add service errors, catalog service, and cart service"
```

---

## Task 9: Orders service and checkout transaction

**Files:**
- Create: `lib/services/orders.ts`
- Test: `test/services-orders.test.ts`

**Interfaces:**
- Consumes: schema (Task 2), `calcTotals` (Task 4), errors and `getCart`/`clearCart` (Task 8).
- Produces:
  - `START_ORDER_NUMBER = 10241`
  - `placeOrder(customerId, input): Promise<Order>` where `input = { addressId: number; paymentMethodId: number; expectedTotalCents?: number }`
  - `listOrders(customerId, opts?): Promise<OrderSummary[]>` where `OrderSummary = Order & { itemCount: number }`
  - `getOrder(customerId, orderNumber): Promise<OrderDetail>` where `OrderDetail = Order & { items: OrderItem[]; address: Address; paymentMethod: PaymentMethod }`

This task owns **Review Focus items 1, 2, and 3**.

- [ ] **Step 1: Write the failing test**

```ts
// test/services-orders.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { withTestDb, seedMinimal, type TestDb } from './harness';

let tdb: TestDb;
let ids: Awaited<ReturnType<typeof seedMinimal>>;
vi.mock('@/db/client', () => ({ get db() { return (globalThis as any).__testDb; } }));

beforeEach(async () => {
  tdb = await withTestDb();
  ids = await seedMinimal(tdb);
  (globalThis as any).__testDb = tdb.db;
});
afterEach(async () => { await tdb.close(); });

async function defaultsFor(customerId: number) {
  const [a] = await tdb.db.select().from(schema.addresses)
    .where(eq(schema.addresses.customerId, customerId));
  const [p] = await tdb.db.select().from(schema.paymentMethods)
    .where(eq(schema.paymentMethods.customerId, customerId));
  return { addressId: a.id, paymentMethodId: p.id };
}

const pack = () => ids.productIds[0];   // $420.00, stock 10
const shell = () => ids.productIds[1];  // $480.00, stock 1
const mug = () => ids.productIds[2];    // $18.00,  stock 50

describe('placeOrder', () => {
  it('places an order, snapshots names and prices, and clears the cart', async () => {
    const { addToCart, getCart } = await import('@/lib/services/cart');
    const { placeOrder } = await import('@/lib/services/orders');
    await addToCart(ids.alice, pack(), 2);

    const order = await placeOrder(ids.alice, await defaultsFor(ids.alice));

    expect(order.subtotalCents).toBe(84000);
    expect(order.shippingCents).toBe(0);
    expect(order.taxCents).toBe(7140);
    expect(order.totalCents).toBe(91140);
    expect(order.status).toBe('placed');

    const items = await tdb.db.select().from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, order.id));
    expect(items[0].nameSnapshot).toBe('Cascade 45L Expedition Pack');
    expect(items[0].unitPriceCents).toBe(42000);
    expect(items[0].lineTotalCents).toBe(84000);

    expect((await getCart(ids.alice)).items).toEqual([]);
  });

  it('numbers the first order 10241', async () => {
    const { addToCart } = await import('@/lib/services/cart');
    const { placeOrder } = await import('@/lib/services/orders');
    await addToCart(ids.alice, mug(), 1);
    const order = await placeOrder(ids.alice, await defaultsFor(ids.alice));
    expect(order.orderNumber).toBe(10241);
  });

  it('increments the order number for the next order', async () => {
    const { addToCart } = await import('@/lib/services/cart');
    const { placeOrder } = await import('@/lib/services/orders');
    await addToCart(ids.alice, mug(), 1);
    await placeOrder(ids.alice, await defaultsFor(ids.alice));
    await addToCart(ids.carol, mug(), 1);
    const second = await placeOrder(ids.carol, await defaultsFor(ids.carol));
    expect(second.orderNumber).toBe(10242);
  });

  it('decrements stock by the ordered quantity', async () => {
    const { addToCart } = await import('@/lib/services/cart');
    const { placeOrder } = await import('@/lib/services/orders');
    await addToCart(ids.alice, pack(), 3);
    await placeOrder(ids.alice, await defaultsFor(ids.alice));
    const [p] = await tdb.db.select().from(schema.products)
      .where(eq(schema.products.id, pack()));
    expect(p.stockQty).toBe(7);
  });

  it('refuses to place an empty order', async () => {
    const { placeOrder } = await import('@/lib/services/orders');
    const { ValidationError } = await import('@/lib/services/errors');
    await expect(placeOrder(ids.alice, await defaultsFor(ids.alice)))
      .rejects.toBeInstanceOf(ValidationError);
  });

  // OWNERSHIP
  it('refuses an address belonging to another customer', async () => {
    const { addToCart } = await import('@/lib/services/cart');
    const { placeOrder } = await import('@/lib/services/orders');
    const { OwnershipError } = await import('@/lib/services/errors');
    await addToCart(ids.alice, mug(), 1);
    const carolDefaults = await defaultsFor(ids.carol);
    const aliceDefaults = await defaultsFor(ids.alice);
    await expect(placeOrder(ids.alice, {
      addressId: carolDefaults.addressId,
      paymentMethodId: aliceDefaults.paymentMethodId,
    })).rejects.toBeInstanceOf(OwnershipError);
  });

  it('refuses a payment method belonging to another customer', async () => {
    const { addToCart } = await import('@/lib/services/cart');
    const { placeOrder } = await import('@/lib/services/orders');
    const { OwnershipError } = await import('@/lib/services/errors');
    await addToCart(ids.alice, mug(), 1);
    const carolDefaults = await defaultsFor(ids.carol);
    const aliceDefaults = await defaultsFor(ids.alice);
    await expect(placeOrder(ids.alice, {
      addressId: aliceDefaults.addressId,
      paymentMethodId: carolDefaults.paymentMethodId,
    })).rejects.toBeInstanceOf(OwnershipError);
  });

  // REVIEW FOCUS 2: a cart item goes inactive between add and checkout.
  it('fails with a named error when a cart product was deactivated', async () => {
    const { addToCart } = await import('@/lib/services/cart');
    const { placeOrder } = await import('@/lib/services/orders');
    const { ValidationError } = await import('@/lib/services/errors');
    await addToCart(ids.alice, pack(), 1);
    await tdb.db.update(schema.products).set({ isActive: false })
      .where(eq(schema.products.id, pack()));

    const err = await placeOrder(ids.alice, await defaultsFor(ids.alice)).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toContain('Cascade 45L Expedition Pack');
  });

  // REVIEW FOCUS 2: stock drops below the cart quantity between add and checkout.
  it('fails with OutOfStockError when stock dropped after the item was added', async () => {
    const { addToCart } = await import('@/lib/services/cart');
    const { placeOrder } = await import('@/lib/services/orders');
    const { OutOfStockError } = await import('@/lib/services/errors');
    await addToCart(ids.alice, pack(), 5);
    await tdb.db.update(schema.products).set({ stockQty: 2 })
      .where(eq(schema.products.id, pack()));

    const err = await placeOrder(ids.alice, await defaultsFor(ids.alice)).catch((e) => e);
    expect(err).toBeInstanceOf(OutOfStockError);
    expect(err.productName).toBe('Cascade 45L Expedition Pack');
  });

  // REVIEW FOCUS 3: price drift between display and checkout.
  it('refuses to charge a total different from the one the customer was shown', async () => {
    const { addToCart, getCart } = await import('@/lib/services/cart');
    const { placeOrder } = await import('@/lib/services/orders');
    const { PriceChangedError } = await import('@/lib/services/errors');
    await addToCart(ids.alice, pack(), 1);
    const shown = (await getCart(ids.alice)).totalCents;

    await tdb.db.update(schema.products).set({ priceCents: 50000 })
      .where(eq(schema.products.id, pack()));

    await expect(placeOrder(ids.alice, {
      ...(await defaultsFor(ids.alice)), expectedTotalCents: shown,
    })).rejects.toBeInstanceOf(PriceChangedError);
  });

  it('accepts a matching expected total', async () => {
    const { addToCart, getCart } = await import('@/lib/services/cart');
    const { placeOrder } = await import('@/lib/services/orders');
    await addToCart(ids.alice, pack(), 1);
    const shown = (await getCart(ids.alice)).totalCents;
    const order = await placeOrder(ids.alice, {
      ...(await defaultsFor(ids.alice)), expectedTotalCents: shown,
    });
    expect(order.totalCents).toBe(shown);
  });

  // REVIEW FOCUS 1: concurrent checkout must not oversell or duplicate a number.
  it('does not oversell the last unit under concurrent checkout', async () => {
    const { addToCart } = await import('@/lib/services/cart');
    const { placeOrder } = await import('@/lib/services/orders');
    await addToCart(ids.alice, shell(), 1);   // stock is 1
    await addToCart(ids.carol, shell(), 1);

    const results = await Promise.allSettled([
      placeOrder(ids.alice, await defaultsFor(ids.alice)),
      placeOrder(ids.carol, await defaultsFor(ids.carol)),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const [p] = await tdb.db.select().from(schema.products)
      .where(eq(schema.products.id, shell()));
    expect(p.stockQty).toBe(0);
  });

  it('never issues the same order number twice under concurrency', async () => {
    const { addToCart } = await import('@/lib/services/cart');
    const { placeOrder } = await import('@/lib/services/orders');
    await addToCart(ids.alice, mug(), 1);
    await addToCart(ids.carol, mug(), 1);
    await addToCart(ids.bob, mug(), 1);

    await Promise.allSettled([
      placeOrder(ids.alice, await defaultsFor(ids.alice)),
      placeOrder(ids.carol, await defaultsFor(ids.carol)),
      placeOrder(ids.bob, await defaultsFor(ids.bob)),
    ]);

    const rows = await tdb.db.select().from(schema.orders);
    const numbers = rows.map((o) => o.orderNumber);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it('rolls back completely when the transaction fails', async () => {
    const { addToCart } = await import('@/lib/services/cart');
    const { placeOrder } = await import('@/lib/services/orders');
    await addToCart(ids.alice, pack(), 1);
    await tdb.db.update(schema.products).set({ stockQty: 0 })
      .where(eq(schema.products.id, pack()));

    await placeOrder(ids.alice, await defaultsFor(ids.alice)).catch(() => {});

    expect(await tdb.db.select().from(schema.orders)).toHaveLength(0);
    expect(await tdb.db.select().from(schema.orderItems)).toHaveLength(0);
    const { getCart } = await import('@/lib/services/cart');
    expect((await getCart(ids.alice)).items).toHaveLength(1);  // cart survives
  });
});

describe('listOrders and getOrder', () => {
  it('lists only the requesting customer\'s orders, newest first', async () => {
    const { addToCart } = await import('@/lib/services/cart');
    const { placeOrder, listOrders } = await import('@/lib/services/orders');
    await addToCart(ids.alice, mug(), 1);
    await placeOrder(ids.alice, await defaultsFor(ids.alice));
    await addToCart(ids.carol, mug(), 1);
    await placeOrder(ids.carol, await defaultsFor(ids.carol));

    const alice = await listOrders(ids.alice);
    expect(alice).toHaveLength(1);
    expect(alice[0].itemCount).toBe(1);
  });

  it('returns full order detail for the owner', async () => {
    const { addToCart } = await import('@/lib/services/cart');
    const { placeOrder, getOrder } = await import('@/lib/services/orders');
    await addToCart(ids.alice, mug(), 2);
    const placed = await placeOrder(ids.alice, await defaultsFor(ids.alice));

    const detail = await getOrder(ids.alice, placed.orderNumber);
    expect(detail.items).toHaveLength(1);
    expect(detail.address.customerId).toBe(ids.alice);
    expect(detail.paymentMethod.last4).toBe('4242');
  });

  // OWNERSHIP: the precursor to every IDOR protection in sub-project B.
  it('refuses to return another customer\'s order', async () => {
    const { addToCart } = await import('@/lib/services/cart');
    const { placeOrder, getOrder } = await import('@/lib/services/orders');
    const { NotFoundError } = await import('@/lib/services/errors');
    await addToCart(ids.alice, mug(), 1);
    const placed = await placeOrder(ids.alice, await defaultsFor(ids.alice));

    await expect(getOrder(ids.carol, placed.orderNumber))
      .rejects.toBeInstanceOf(NotFoundError);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm test test/services-orders.test.ts` → Expected: FAIL — cannot resolve `@/lib/services/orders`.

- [ ] **Step 3: Write `lib/services/orders.ts`**

```ts
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import {
  addresses, carts, cartItems, orders, orderItems, paymentMethods, products,
  type Address, type Order, type OrderItem, type PaymentMethod,
} from '@/db/schema';
import { calcTotals } from '@/lib/money';
import {
  NotFoundError, OutOfStockError, OwnershipError, PriceChangedError, ValidationError,
} from './errors';

/** Seeded history runs 10225–10240, so the first order placed is 10241. */
export const START_ORDER_NUMBER = 10241;

const PlaceOrderSchema = z.object({
  addressId: z.number().int().positive(),
  paymentMethodId: z.number().int().positive(),
  /** The total the customer was shown. When present it is enforced. */
  expectedTotalCents: z.number().int().nonnegative().optional(),
});
export type PlaceOrderInput = z.input<typeof PlaceOrderSchema>;

export type OrderSummary = Order & { itemCount: number };
export type OrderDetail = Order & {
  items: OrderItem[]; address: Address; paymentMethod: PaymentMethod;
};

export async function placeOrder(
  customerId: number, rawInput: PlaceOrderInput,
): Promise<Order> {
  const parsed = PlaceOrderSchema.safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0].message);
  const input = parsed.data;

  return db.transaction(async (tx) => {
    const [cart] = await tx.select().from(carts)
      .where(eq(carts.customerId, customerId)).limit(1);
    if (!cart) throw new ValidationError('Your cart is empty');

    const lines = await tx.select({ item: cartItems, product: products })
      .from(cartItems)
      .innerJoin(products, eq(cartItems.productId, products.id))
      .where(eq(cartItems.cartId, cart.id));
    if (lines.length === 0) throw new ValidationError('Your cart is empty');

    // Ownership: both references must belong to THIS customer. Scoping the
    // lookup by customerId is what makes this safe rather than a post-hoc check.
    const [address] = await tx.select().from(addresses)
      .where(and(eq(addresses.id, input.addressId), eq(addresses.customerId, customerId)))
      .limit(1);
    if (!address) throw new OwnershipError('Address');

    const [payment] = await tx.select().from(paymentMethods)
      .where(and(eq(paymentMethods.id, input.paymentMethodId),
                 eq(paymentMethods.customerId, customerId)))
      .limit(1);
    if (!payment) throw new OwnershipError('Payment method');

    // Re-validate every line against CURRENT catalog state. A product can go
    // inactive or sell out between the moment it was added and this checkout.
    for (const { item, product } of lines) {
      if (!product.isActive) {
        throw new ValidationError(`${product.name} is no longer available`);
      }
      if (item.quantity > product.stockQty) {
        throw new OutOfStockError(product.name, product.stockQty);
      }
    }

    const subtotalCents = lines.reduce(
      (sum, { item, product }) => sum + product.priceCents * item.quantity, 0);
    const totals = calcTotals(subtotalCents);

    // The customer is charged the total they were shown, or told it moved.
    if (input.expectedTotalCents !== undefined
        && input.expectedTotalCents !== totals.totalCents) {
      throw new PriceChangedError(input.expectedTotalCents, totals.totalCents);
    }

    for (const { item, product } of lines) {
      await tx.update(products)
        .set({ stockQty: product.stockQty - item.quantity })
        .where(eq(products.id, product.id));
    }

    // `orders.order_number` is UNIQUE, so if two transactions ever computed the
    // same max+1 the second insert fails and its whole transaction rolls back.
    const [{ maxNumber }] = await tx
      .select({ maxNumber: sql<number | null>`max(${orders.orderNumber})` }).from(orders);
    const orderNumber = maxNumber === null ? START_ORDER_NUMBER : Number(maxNumber) + 1;

    const [order] = await tx.insert(orders).values({
      orderNumber, customerId, status: 'placed', placedAt: new Date(),
      subtotalCents: totals.subtotalCents, taxCents: totals.taxCents,
      shippingCents: totals.shippingCents, totalCents: totals.totalCents,
      shippingAddressId: address.id, paymentMethodId: payment.id,
    }).returning();

    await tx.insert(orderItems).values(lines.map(({ item, product }) => ({
      orderId: order.id, productId: product.id,
      nameSnapshot: product.name, unitPriceCents: product.priceCents,
      quantity: item.quantity, lineTotalCents: product.priceCents * item.quantity,
    })));

    await tx.delete(cartItems).where(eq(cartItems.cartId, cart.id));
    return order;
  });
}

export async function listOrders(
  customerId: number, opts: { limit?: number } = {},
): Promise<OrderSummary[]> {
  const rows = await db.select({
      order: orders,
      itemCount: sql<number>`(select coalesce(sum(${orderItems.quantity}), 0)
                              from ${orderItems}
                              where ${orderItems.orderId} = ${orders.id})`,
    })
    .from(orders)
    .where(eq(orders.customerId, customerId))
    .orderBy(desc(orders.placedAt))
    .limit(opts.limit ?? 50);

  return rows.map((r) => ({ ...r.order, itemCount: Number(r.itemCount) }));
}

export async function getOrder(
  customerId: number, orderNumber: number,
): Promise<OrderDetail> {
  // Scoped by customerId: another customer's order is NOT FOUND, not FORBIDDEN.
  // Returning 403 here would confirm the order exists.
  const [order] = await db.select().from(orders)
    .where(and(eq(orders.orderNumber, orderNumber), eq(orders.customerId, customerId)))
    .limit(1);
  if (!order) throw new NotFoundError('Order');

  const items = await db.select().from(orderItems)
    .where(eq(orderItems.orderId, order.id));
  const [address] = await db.select().from(addresses)
    .where(eq(addresses.id, order.shippingAddressId));
  const [paymentMethod] = await db.select().from(paymentMethods)
    .where(eq(paymentMethods.id, order.paymentMethodId));

  return { ...order, items, address, paymentMethod };
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm test test/services-orders.test.ts` → Expected: PASS (17 tests).

If the concurrency tests are flaky, that is a real finding, not a test problem: libsql serializes writes on a local file, so both should be deterministic. Investigate before weakening the assertion.

- [ ] **Step 5: Run everything and commit**

Run: `pnpm test` → Expected: all suites PASS.

```bash
git add lib/services/orders.ts test/services-orders.test.ts
git commit -m "feat: add orders service with transactional checkout and stock guards"
```

---

## Task 10: Account services and the full seed

**Files:**
- Create: `lib/services/profile.ts`, `lib/services/addresses.ts`, `lib/services/paymentMethods.ts`
- Create: `db/seed/customers.ts`, `db/seed/account.ts`, `db/seed/orders.ts`, `db/seed/index.ts`
- Test: `test/services-account.test.ts`, `test/seed.test.ts`

**Interfaces:**
- Consumes: schema (Task 2), errors (Task 8), `seedCatalog` (Task 7).
- Produces:
  - `getProfile(customerId): Promise<{ id; name; email; emailVerified; createdAt }>`
  - `updateProfile(customerId, { name }): Promise<void>` — **browser-only; see note**
  - `listAddresses(customerId): Promise<Address[]>`, `upsertAddress(customerId, input): Promise<Address>`, `deleteAddress(customerId, id)`, `setDefaultAddress(customerId, id)`
  - `listPaymentMethods(customerId): Promise<PaymentMethod[]>`, `addPaymentMethod(customerId, input): Promise<PaymentMethod>`, `deletePaymentMethod(customerId, id)`, `setDefaultPaymentMethod(customerId, id)`
  - `pnpm db:setup` produces the full demo database

**Note on `updateProfile`:** the parent project's scope list contains `profile.read` with no write counterpart, and its MCP tool list contains `get_profile` with no `update_profile`. Agents therefore cannot change a customer's name by design. `updateProfile` is a browser-only operation. Do not add a write scope during implementation — that is a change to the parent spec.

- [ ] **Step 1: Write `lib/services/profile.ts`**

```ts
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { customers } from '@/db/schema';
import { NotFoundError, ValidationError } from './errors';

export type Profile = {
  id: number; name: string; email: string;
  emailVerified: boolean; createdAt: Date;
};

export async function getProfile(customerId: number): Promise<Profile> {
  const [c] = await db.select().from(customers).where(eq(customers.id, customerId)).limit(1);
  if (!c) throw new NotFoundError('Customer');
  return {
    id: c.id, name: c.name, email: c.email,
    emailVerified: c.emailVerified, createdAt: c.createdAt,
  };
}

const UpdateSchema = z.object({ name: z.string().trim().min(1).max(120) });

/** Browser-only. No agent scope exists for this operation — see the task note. */
export async function updateProfile(
  customerId: number, input: z.input<typeof UpdateSchema>,
): Promise<void> {
  const parsed = UpdateSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0].message);
  await db.update(customers).set({ name: parsed.data.name })
    .where(eq(customers.id, customerId));
}
```

- [ ] **Step 2: Write `lib/services/addresses.ts`**

```ts
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { addresses, type Address } from '@/db/schema';
import { NotFoundError, ValidationError } from './errors';

const AddressSchema = z.object({
  id: z.number().int().positive().optional(),
  label: z.string().trim().min(1).max(40),
  recipient: z.string().trim().min(1).max(120),
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().max(200).optional().nullable(),
  city: z.string().trim().min(1).max(100),
  region: z.string().trim().min(1).max(100),
  postalCode: z.string().trim().min(1).max(20),
  country: z.string().trim().length(2).default('US'),
  phone: z.string().trim().max(40).optional().nullable(),
  isDefault: z.boolean().default(false),
});
export type AddressInput = z.input<typeof AddressSchema>;

export async function listAddresses(customerId: number): Promise<Address[]> {
  return db.select().from(addresses)
    .where(eq(addresses.customerId, customerId))
    .orderBy(desc(addresses.isDefault), desc(addresses.createdAt));
}

export async function upsertAddress(
  customerId: number, raw: AddressInput,
): Promise<Address> {
  const parsed = AddressSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0].message);
  const { id, ...values } = parsed.data;

  if (values.isDefault) await clearDefaults(customerId);

  if (id !== undefined) {
    // Scoped by customerId: editing someone else's address is NOT FOUND.
    const [updated] = await db.update(addresses)
      .set({ ...values, line2: values.line2 ?? null, phone: values.phone ?? null })
      .where(and(eq(addresses.id, id), eq(addresses.customerId, customerId)))
      .returning();
    if (!updated) throw new NotFoundError('Address');
    return updated;
  }

  const [created] = await db.insert(addresses).values({
    ...values, customerId, line2: values.line2 ?? null,
    phone: values.phone ?? null, createdAt: new Date(),
  }).returning();
  return created;
}

export async function deleteAddress(customerId: number, id: number): Promise<void> {
  const deleted = await db.delete(addresses)
    .where(and(eq(addresses.id, id), eq(addresses.customerId, customerId)))
    .returning();
  if (deleted.length === 0) throw new NotFoundError('Address');
}

export async function setDefaultAddress(customerId: number, id: number): Promise<void> {
  await clearDefaults(customerId);
  const updated = await db.update(addresses).set({ isDefault: true })
    .where(and(eq(addresses.id, id), eq(addresses.customerId, customerId)))
    .returning();
  if (updated.length === 0) throw new NotFoundError('Address');
}

async function clearDefaults(customerId: number) {
  await db.update(addresses).set({ isDefault: false })
    .where(eq(addresses.customerId, customerId));
}
```

- [ ] **Step 3: Write `lib/services/paymentMethods.ts`**

Same shape as `addresses.ts`. Schema:

```ts
const PaymentMethodSchema = z.object({
  brand: z.enum(['visa', 'mastercard', 'amex']),
  // SECURITY: last four digits only. There is deliberately no field on this
  // schema, and no column in the table, that could carry a full card number.
  // Sub-project D denies agents this operation outright.
  last4: z.string().regex(/^\d{4}$/, 'Enter the last four digits'),
  expMonth: z.number().int().min(1).max(12),
  expYear: z.number().int().min(2024).max(2099),
  holderName: z.string().trim().min(1).max(120),
  isDefault: z.boolean().default(false),
});
```

Functions: `listPaymentMethods`, `addPaymentMethod`, `deletePaymentMethod`, `setDefaultPaymentMethod`, each scoped by `customerId` exactly as the address service is, each throwing `NotFoundError` when the row does not belong to the caller. There is no update function — a card is added or removed.

- [ ] **Step 4: Write the account services test**

```ts
// test/services-account.test.ts — abbreviated; write the full set.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { withTestDb, seedMinimal, type TestDb } from './harness';

let tdb: TestDb; let ids: Awaited<ReturnType<typeof seedMinimal>>;
vi.mock('@/db/client', () => ({ get db() { return (globalThis as any).__testDb; } }));
beforeEach(async () => {
  tdb = await withTestDb(); ids = await seedMinimal(tdb);
  (globalThis as any).__testDb = tdb.db;
});
afterEach(async () => { await tdb.close(); });

describe('account services', () => {
  it('returns the profile for the requesting customer', async () => {
    const { getProfile } = await import('@/lib/services/profile');
    expect((await getProfile(ids.alice)).email).toBe('alice@example.com');
  });

  it('lists only the requesting customer\'s addresses', async () => {
    const { listAddresses } = await import('@/lib/services/addresses');
    const alice = await listAddresses(ids.alice);
    expect(alice).toHaveLength(1);
    expect(alice[0].customerId).toBe(ids.alice);
  });

  it('refuses to edit another customer\'s address', async () => {
    const { listAddresses, upsertAddress } = await import('@/lib/services/addresses');
    const { NotFoundError } = await import('@/lib/services/errors');
    const [carolAddr] = await listAddresses(ids.carol);
    await expect(upsertAddress(ids.alice, {
      id: carolAddr.id, label: 'Stolen', recipient: 'A', line1: '1 St',
      city: 'Portland', region: 'OR', postalCode: '97201',
    })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses to delete another customer\'s address', async () => {
    const { listAddresses, deleteAddress } = await import('@/lib/services/addresses');
    const { NotFoundError } = await import('@/lib/services/errors');
    const [carolAddr] = await listAddresses(ids.carol);
    await expect(deleteAddress(ids.alice, carolAddr.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('keeps exactly one default address', async () => {
    const { upsertAddress, listAddresses } = await import('@/lib/services/addresses');
    await upsertAddress(ids.alice, {
      label: 'Work', recipient: 'Alice Chen', line1: '2 Office Way',
      city: 'Portland', region: 'OR', postalCode: '97202', isDefault: true,
    });
    const all = await listAddresses(ids.alice);
    expect(all.filter((a) => a.isDefault)).toHaveLength(1);
  });

  it('rejects a payment method with anything longer than four digits', async () => {
    const { addPaymentMethod } = await import('@/lib/services/paymentMethods');
    const { ValidationError } = await import('@/lib/services/errors');
    await expect(addPaymentMethod(ids.alice, {
      brand: 'visa', last4: '4242424242424242', expMonth: 6,
      expYear: 2030, holderName: 'Alice Chen',
    } as never)).rejects.toBeInstanceOf(ValidationError);
  });

  it('refuses to delete another customer\'s payment method', async () => {
    const { listPaymentMethods, deletePaymentMethod } =
      await import('@/lib/services/paymentMethods');
    const { NotFoundError } = await import('@/lib/services/errors');
    const [carolCard] = await listPaymentMethods(ids.carol);
    await expect(deletePaymentMethod(ids.alice, carolCard.id))
      .rejects.toBeInstanceOf(NotFoundError);
  });
});
```

- [ ] **Step 5: Write the seed modules**

`db/seed/customers.ts` — the three customers exactly as the spec's table defines them, plus Bob's `legacy_credentials` row. Documented passwords:

```ts
/**
 * Demo passwords. These are documented in the README; this is a reference
 * implementation with no real users. Do not copy this pattern into production.
 *
 *   alice@example.com  →  alpine-trail-2019      (local hash)
 *   bob@example.com    →  northbound-legacy-99   (LEGACY BACKEND ONLY)
 *   carol@example.com  →  summit-ridge-4410      (local hash)
 *
 * Bob's password is written ONLY to legacy_credentials. customers.password_hash
 * stays NULL for him — that is what makes the delegation demo real.
 */
```

Alice `id 82731`, `emailVerified true`, `authBackend 'local'`, `signupOrigin 'web'`, `createdAt 2021-03-14`.
Bob `id 19382`, `emailVerified false`, `passwordHash null`, `authBackend 'legacy'`, `signupOrigin 'web'`, `createdAt 2019-06-02`; legacy row `legacyUserId 5501`.
Carol `id 44102`, `emailVerified true`, `authBackend 'local'`, `signupOrigin 'google'`, `createdAt 2023-08-21`, `passwordSetAt 2024-05-09` — after `createdAt`, because "signed up with Google" and "has a password" only cohere if she set one later.

`db/seed/account.ts` — Alice 2 addresses + 2 cards, Bob 1 + 1, Carol 1 + 1; exactly one default each.

`db/seed/orders.ts` — 16 orders numbered **10225–10240**, spread across the last six months: Alice 8, Carol 5, Bob 3. Status is `delivered` when `placedAt` is more than 30 days ago and `shipped` otherwise. Each order carries 1–4 line items drawn from the catalog, with `nameSnapshot` and `unitPriceCents` copied from the product at seed time, and totals computed with `calcTotals`. Seeding must **not** decrement `stockQty` — historical orders are not current demand.

`db/seed/index.ts` — truncate in FK-safe order, then `seedCatalog` → customers → account → orders, and log a summary.

- [ ] **Step 6: Write the seed test**

```ts
// test/seed.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { legacyCredentials } from '@/db/schema/legacy';
import { withTestDb, type TestDb } from './harness';

let tdb: TestDb;
vi.mock('@/db/client', () => ({ get db() { return (globalThis as any).__testDb; } }));
beforeEach(async () => {
  tdb = await withTestDb(); (globalThis as any).__testDb = tdb.db;
  const { seedAll } = await import('@/db/seed/index');
  await seedAll(tdb.db);
});
afterEach(async () => { await tdb.close(); });

describe('full seed', () => {
  it('creates 64 products across 8 categories', async () => {
    expect(await tdb.db.select().from(schema.products)).toHaveLength(64);
    expect(await tdb.db.select().from(schema.categories)).toHaveLength(8);
  });

  it('creates the three customers with their documented ids', async () => {
    const rows = await tdb.db.select().from(schema.customers);
    expect(rows.map((c) => c.id).sort()).toEqual([19382, 44102, 82731]);
  });

  it('leaves Bob without a local password hash', async () => {
    const [bob] = await tdb.db.select().from(schema.customers)
      .where(eq(schema.customers.id, 19382));
    expect(bob.passwordHash).toBeNull();
    expect(bob.emailVerified).toBe(false);
    expect(bob.authBackend).toBe('legacy');
  });

  it('puts Bob\'s credential in the legacy backend only', async () => {
    const rows = await tdb.db.select().from(legacyCredentials);
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe('bob@example.com');
  });

  it('records Carol as a Google signup who set a password later', async () => {
    const [carol] = await tdb.db.select().from(schema.customers)
      .where(eq(schema.customers.id, 44102));
    expect(carol.signupOrigin).toBe('google');
    expect(carol.passwordSetAt!.getTime()).toBeGreaterThan(carol.createdAt.getTime());
  });

  it('seeds 16 orders numbered 10225 to 10240', async () => {
    const rows = await tdb.db.select().from(schema.orders);
    expect(rows).toHaveLength(16);
    const numbers = rows.map((o) => o.orderNumber).sort((a, b) => a - b);
    expect(numbers[0]).toBe(10225);
    expect(numbers[15]).toBe(10240);
  });

  it('makes the next order placed number 10241', async () => {
    const { addToCart } = await import('@/lib/services/cart');
    const { placeOrder } = await import('@/lib/services/orders');
    const [addr] = await tdb.db.select().from(schema.addresses)
      .where(eq(schema.addresses.customerId, 82731));
    const [pm] = await tdb.db.select().from(schema.paymentMethods)
      .where(eq(schema.paymentMethods.customerId, 82731));
    const [product] = await tdb.db.select().from(schema.products).limit(1);

    await addToCart(82731, product.id, 1);
    const order = await placeOrder(82731, { addressId: addr.id, paymentMethodId: pm.id });
    expect(order.orderNumber).toBe(10241);
  });

  it('distributes orders 8/5/3 across Alice, Carol and Bob', async () => {
    const rows = await tdb.db.select().from(schema.orders);
    const count = (id: number) => rows.filter((o) => o.customerId === id).length;
    expect([count(82731), count(44102), count(19382)]).toEqual([8, 5, 3]);
  });

  it('shows more than one order status', async () => {
    const rows = await tdb.db.select().from(schema.orders);
    expect(new Set(rows.map((o) => o.status)).size).toBeGreaterThan(1);
  });

  it('computes seeded order totals with the same money rules as checkout', async () => {
    const { calcTotals } = await import('@/lib/money');
    for (const o of await tdb.db.select().from(schema.orders)) {
      expect({
        shippingCents: o.shippingCents, taxCents: o.taxCents, totalCents: o.totalCents,
      }).toMatchObject({
        shippingCents: calcTotals(o.subtotalCents).shippingCents,
        taxCents: calcTotals(o.subtotalCents).taxCents,
        totalCents: calcTotals(o.subtotalCents).totalCents,
      });
    }
  });
});
```

- [ ] **Step 7: Run everything, build the real database, and commit**

Run: `pnpm test` → Expected: all suites PASS.
Run: `rm -rf data && pnpm db:setup` → Expected: summary logs 8 categories, 64 products, 3 customers, 16 orders.
Run: `pnpm db:setup` a second time → Expected: identical counts, no duplicate-key errors.

```bash
git add lib/services db/seed test/services-account.test.ts test/seed.test.ts
git commit -m "feat: add account services and the full deterministic demo seed"
```

---

## Task 11: Brand components

**Files:**
- Create: `components/brand/{Button,Nav,Footer,ProductCard,Price,Field}.tsx`
- Modify: `app/layout.tsx` — wrap children in `Nav` and `Footer`
- Test: `test/brand.test.tsx`

**Interfaces:**
- Consumes: `formatCents` (Task 4), `getCurrentCustomer` (Task 6), `getCart` (Task 8).
- Produces:
  - `<Button variant="primary" | "secondary" | "ghost" as?="button" | "link" href?>`
  - `<Nav />` — server component; reads the session and cart count
  - `<ProductCard product={Product} />`
  - `<Price cents={number} />`, `<Field label name type error>`

- [ ] **Step 1: Write `components/brand/Button.tsx`**

Three roles, exactly as the spec defines them. The `ghost` variant is built here but **not used anywhere in sub-project A** — it exists so sub-project C's consent screen has an Approve/Deny pair from a coherent system rather than inventing one under deadline.

```tsx
import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

const base = 'inline-flex items-center justify-center font-sans transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';

const variants = {
  /** The main action on a surface. */
  primary:
    'bg-spruce text-paper rounded-[3px] px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.11em] hover:bg-[#26493d]',
  /** Editorial rule: browsing and navigation away from the current surface. */
  secondary:
    'relative bg-transparent px-0 pb-[5px] text-[11px] font-semibold uppercase tracking-[0.13em] text-ember after:absolute after:left-0 after:bottom-0 after:h-px after:w-[22px] after:bg-ember after:transition-[width] after:duration-300 hover:after:w-full',
  /**
   * Decision pairs ONLY — consent screens, approval prompts, destructive
   * confirmations. Sized to match `primary` so the two read as a real pair.
   * Unused in the storefront; sub-project C consumes it.
   */
  ghost:
    'border border-spruce text-spruce rounded-[3px] px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.11em] hover:bg-spruce hover:text-paper',
} as const;

type Variant = keyof typeof variants;

export function Button(
  { variant = 'primary', className = '', children, ...rest }:
  { variant?: Variant; children: ReactNode } & ComponentProps<'button'>,
) {
  return (
    <button className={`${base} ${variants[variant]} ${className}`} {...rest}>
      {children}
    </button>
  );
}

export function ButtonLink(
  { variant = 'primary', className = '', children, href }:
  { variant?: Variant; children: ReactNode; href: string },
) {
  return (
    <Link href={href} className={`${base} ${variants[variant]} ${className}`}>
      {children}
    </Link>
  );
}
```

- [ ] **Step 2: Write `components/brand/Nav.tsx`**

Direction B's structure with direction A's palette: uppercase 11px links at `0.11em` tracking, a 2px ink bottom rule, Fraunces wordmark in spruce.

```tsx
import Link from 'next/link';
import { getCurrentCustomer } from '@/lib/auth/session';
import { getCart } from '@/lib/services/cart';

export async function Nav() {
  const customer = await getCurrentCustomer();
  const cart = customer ? await getCart(customer.id) : null;
  const count = cart?.items.reduce((n, i) => n + i.quantity, 0) ?? 0;

  return (
    <header className="border-b-2 border-ink bg-paper">
      <nav className="mx-auto flex max-w-6xl items-center gap-7 px-6 py-4">
        <Link href="/" className="display mr-auto text-[21px] text-spruce">Northbound</Link>
        {[['/shop', 'Shop'], ['/orders', 'Orders'], ['/account', 'Account']].map(([href, label]) => (
          <Link key={href} href={href}
            className="text-[11px] font-medium uppercase tracking-[0.11em] text-ink hover:text-spruce">
            {label}
          </Link>
        ))}
        <Link href="/cart"
          className="text-[11px] font-semibold uppercase tracking-[0.11em] text-spruce">
          Cart ({count})
        </Link>
        {customer
          ? <form action="/api-less-logout" className="contents" />
          : <Link href="/login"
              className="text-[11px] font-medium uppercase tracking-[0.11em] text-ink">
              Sign in
            </Link>}
      </nav>
    </header>
  );
}
```

Replace the `form` placeholder with a server-action sign-out button once Task 13 defines `logoutAction`. Do not leave a route named `/api-less-logout` in the tree.

- [ ] **Step 3: Write `ProductCard`, `Price`, `Field`, `Footer`**

`ProductCard` — `next/image` at 4:3 with `rounded-[7px]`, uppercase muted category label, Fraunces product name, price in Figtree 500. Whole card is a link to `/product/[slug]`.
`Price` — wraps `formatCents`, renders `<span className="tabular-nums">`.
`Field` — label, input, and an ember error message; used by every form in Tasks 12–15.
`Footer` — three columns on the cream ground with a 1px `--rule` top border.

- [ ] **Step 4: Write the brand test**

```tsx
// test/brand.test.tsx
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button } from '@/components/brand/Button';
import { Price } from '@/components/brand/Price';

describe('brand components', () => {
  it('renders the three button roles with distinct treatments', () => {
    const primary = renderToStaticMarkup(<Button variant="primary">Add</Button>);
    const secondary = renderToStaticMarkup(<Button variant="secondary">View</Button>);
    const ghost = renderToStaticMarkup(<Button variant="ghost">Deny</Button>);
    expect(primary).toContain('bg-spruce');
    expect(secondary).toContain('text-ember');
    expect(ghost).toContain('border-spruce');
    expect(new Set([primary, secondary, ghost]).size).toBe(3);
  });

  it('formats prices with tabular numerals', () => {
    const html = renderToStaticMarkup(<Price cents={42000} />);
    expect(html).toContain('$420.00');
    expect(html).toContain('tabular-nums');
  });
});
```

Add `pnpm add -D @vitejs/plugin-react react-dom` and set `environment: 'jsdom'` for `test/**/*.test.tsx` via a Vitest workspace entry, or use `// @vitest-environment jsdom`.

- [ ] **Step 5: Verify and commit**

Run: `pnpm test test/brand.test.tsx` → Expected: PASS (2 tests).
Run: `pnpm dev` → Expected: nav renders with the 2px rule, spruce Fraunces wordmark, and `Cart (0)`.

```bash
git add components/brand app/layout.tsx test/brand.test.tsx
git commit -m "feat: add Northbound brand components with three button roles"
```

---

## Task 12: Storefront pages

**Files:**
- Modify: `app/page.tsx`
- Create: `app/shop/page.tsx`, `app/shop/[category]/page.tsx`, `app/product/[slug]/page.tsx`
- Create: `app/product/[slug]/actions.ts`
- Test: `test/pages-catalog.test.ts`

**Interfaces:**
- Consumes: `listCategories`, `searchProducts`, `getProductBySlug` (Task 8); `addToCart` (Task 8); `requireCustomer` (Task 6); brand components (Task 11).
- Produces: `addToCartAction(formData: FormData): Promise<{ error?: string }>` in `app/product/[slug]/actions.ts`.

- [ ] **Step 1: Write the landing page**

Server component. Eyebrow in ember (`New for autumn`), Fraunces headline `Gear that earns its place on your back.`, a three-up `ProductCard` grid from `searchProducts({ perPage: 3 })`, a category strip from `listCategories()`, and a `secondary` button reading `Shop all gear` linking to `/shop`. Generous whitespace: `py-24` on the hero, `max-w-6xl` container, `px-6` gutter.

- [ ] **Step 2: Write `app/shop/page.tsx` and `app/shop/[category]/page.tsx`**

Both read filters from `searchParams` (`q`, `sort`, `min`, `max`, `page`) and call `searchProducts`. The category page adds `categorySlug` from the route param and calls `notFound()` when `searchProducts` returns `total: 0` **and** the slug is not in `listCategories()` — an empty real category is a valid page, a nonexistent one is a 404.

Sidebar: category list, price range inputs, sort select. Grid: `ProductCard` at `grid-cols-2 md:grid-cols-3` with `gap-x-5 gap-y-9`.

- [ ] **Step 3: Write `app/product/[slug]/page.tsx` and its action**

```ts
// app/product/[slug]/actions.ts
'use server';

import { revalidatePath } from 'next/cache';
import { requireCustomer } from '@/lib/auth/session';
import { addToCart } from '@/lib/services/cart';
import { ServiceError } from '@/lib/services/errors';

export async function addToCartAction(formData: FormData): Promise<{ error?: string }> {
  const customer = await requireCustomer();
  const productId = Number(formData.get('productId'));
  const quantity = Number(formData.get('quantity') ?? 1);

  try {
    // Validation lives in the service, not here. This action only translates
    // a ServiceError into something a form can render.
    await addToCart(customer.id, productId, quantity);
  } catch (e) {
    if (e instanceof ServiceError) return { error: e.message };
    throw e;
  }

  revalidatePath('/cart');
  revalidatePath(`/product/${formData.get('slug')}`);
  return {};
}
```

Page: two-column at `md`, image left at 4:3 `rounded-lg`, right column with uppercase muted category, Fraunces `text-4xl` name, `Price` at `text-2xl`, description at `leading-relaxed text-ink/80`, a quantity `select` 1–10 capped at `stockQty`, a `primary` `Add to cart` submit, and a `secondary` link back to the category. When `stockQty === 0`, replace the button with a disabled `Out of stock` and keep the page rendering.

- [ ] **Step 4: Write the page test**

```ts
// test/pages-catalog.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { withTestDb, seedMinimal, type TestDb } from './harness';

let tdb: TestDb; let ids: Awaited<ReturnType<typeof seedMinimal>>;
vi.mock('@/db/client', () => ({ get db() { return (globalThis as any).__testDb; } }));
beforeEach(async () => {
  tdb = await withTestDb(); ids = await seedMinimal(tdb);
  (globalThis as any).__testDb = tdb.db;
});
afterEach(async () => { await tdb.close(); });

describe('catalog page data', () => {
  it('returns a renderable three-up set for the landing page', async () => {
    const { searchProducts } = await import('@/lib/services/catalog');
    const { items } = await searchProducts({ perPage: 3 });
    expect(items.length).toBeLessThanOrEqual(3);
    for (const p of items) {
      expect(p.imagePath).toMatch(/^\/products\/.+\.webp$/);
      expect(p.name.length).toBeGreaterThan(0);
    }
  });

  it('resolves a category slug to its products', async () => {
    const { searchProducts } = await import('@/lib/services/catalog');
    const { items } = await searchProducts({ categorySlug: 'packs-bags' });
    expect(items.length).toBeGreaterThan(0);
  });

  it('returns an empty result rather than throwing for an unknown category', async () => {
    const { searchProducts } = await import('@/lib/services/catalog');
    expect(await searchProducts({ categorySlug: 'no-such-category' }))
      .toEqual({ items: [], total: 0 });
  });
});
```

- [ ] **Step 5: Verify and commit**

Run: `pnpm test test/pages-catalog.test.ts` → Expected: PASS (3 tests).
Run: `pnpm dev` and walk `/` → `/shop` → `/shop/outerwear` → a product page.
Expected: real photography, Fraunces headings, ember eyebrows, no layout shift, no broken images.

```bash
git add app/page.tsx app/shop app/product test/pages-catalog.test.ts
git commit -m "feat: add landing, shop, category, and product detail pages"
```

---

## Task 13: Login, signup, and sign-out

**Files:**
- Create: `app/login/page.tsx`, `app/login/actions.ts`, `app/signup/page.tsx`, `app/signup/actions.ts`
- Modify: `components/brand/Nav.tsx` — replace the sign-out placeholder
- Test: `test/auth-actions.test.ts`

**Interfaces:**
- Consumes: `verifyCredentials` (Task 6), `createSession`, `revokeSession`, `SESSION_COOKIE` (Task 6), `hashPassword` (Task 4).
- Produces: `loginAction(prev, formData): Promise<{ error?: string }>`, `signupAction(prev, formData)`, `logoutAction(): Promise<void>`.

- [ ] **Step 1: Write `app/login/actions.ts`**

```ts
'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { verifyCredentials } from '@/lib/auth/verify';
import { createSession, revokeSession, SESSION_COOKIE, SESSION_TTL_MS } from '@/lib/auth/session';

/**
 * SECURITY BOUNDARY — where the customer's credential is entered.
 *
 * The password arrives here from Northbound's own form over the same origin,
 * is handed straight to verifyCredentials, and is never stored, logged, or
 * forwarded anywhere except (for legacy accounts) the legacy backend, server
 * side. Nothing about this path is reachable by a third party.
 */
export async function loginAction(
  _prev: { error?: string }, formData: FormData,
): Promise<{ error?: string }> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  if (!email || !password) return { error: 'Enter your email and password.' };

  const result = await verifyCredentials(email, password);
  // One message for every failure: wrong password and unknown account must be
  // indistinguishable, or the form enumerates accounts.
  if (!result.ok || !result.customerId) {
    return { error: 'That email and password do not match an account.' };
  }

  const ua = (await headers()).get('user-agent') ?? undefined;
  const token = await createSession(result.customerId, ua);

  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/', maxAge: SESSION_TTL_MS / 1000,
  });

  redirect('/');
}

export async function logoutAction(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  // Revoke server-side AND clear the cookie, so a copied cookie is already dead.
  if (token) await revokeSession(token);
  store.delete(SESSION_COOKIE);
  redirect('/login');
}
```

- [ ] **Step 2: Write `app/signup/actions.ts`**

Validates with Zod (`email`, `name` 1–120, `password` min 10), lowercases the email, rejects a duplicate with `That email is already registered.`, inserts a customer with `authBackend: 'local'`, `signupOrigin: 'web'`, `emailVerified: false`, `passwordSetAt: now`, then creates a session and redirects to `/`. It must let SQLite allocate the id — never hardcode one near the seeded 19382/44102/82731.

- [ ] **Step 3: Write the pages**

Both are centred single-column at `max-w-md` on the cream ground, in a `--surface` card with a 1px `--rule` border. Fraunces `text-3xl` heading, `Field` components, a full-width `primary` submit, and a `secondary` link to the other page. Login shows a muted `Demo accounts` block listing the three seeded emails — but **not** their passwords; those live in the README.

Replace the `Nav` placeholder with a real sign-out: `<form action={logoutAction}><button className="text-[11px] uppercase tracking-[0.11em]">Sign out</button></form>`, and delete the `/api-less-logout` placeholder.

- [ ] **Step 4: Write the test**

```ts
// test/auth-actions.test.ts — the behaviours, driven through verifyCredentials
// and the session layer rather than through Next's action runtime.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { withTestDb, seedMinimal, type TestDb } from './harness';

let tdb: TestDb;
vi.mock('@/db/client', () => ({ get db() { return (globalThis as any).__testDb; } }));
beforeEach(async () => {
  tdb = await withTestDb(); await seedMinimal(tdb);
  (globalThis as any).__testDb = tdb.db;
  process.env.LEGACY_AUTH_SERVICE_TOKEN = 'test-token';
});
afterEach(async () => { await tdb.close(); });

describe('login behaviour', () => {
  it('issues a session for each of the three seeded customers', async () => {
    const { verifyCredentials } = await import('@/lib/auth/verify');
    const { createSession, resolveSession } = await import('@/lib/auth/session');

    for (const [email, password, id] of [
      ['alice@example.com', 'password123', 82731],
      ['bob@example.com', 'legacy-pass-2019', 19382],
      ['carol@example.com', 'password123', 44102],
    ] as const) {
      const r = await verifyCredentials(email, password);
      expect(r.ok, email).toBe(true);
      const token = await createSession(r.customerId!);
      expect((await resolveSession(token))?.id).toBe(id);
    }
  });

  it('gives the same failure for a wrong password and an unknown account', async () => {
    const { verifyCredentials } = await import('@/lib/auth/verify');
    expect(await verifyCredentials('alice@example.com', 'wrong')).toEqual({ ok: false });
    expect(await verifyCredentials('ghost@example.com', 'wrong')).toEqual({ ok: false });
  });

  it('kills the session on sign-out', async () => {
    const { createSession, revokeSession, resolveSession } = await import('@/lib/auth/session');
    const token = await createSession(82731);
    await revokeSession(token);
    expect(await resolveSession(token)).toBeNull();
  });
});
```

- [ ] **Step 5: Verify and commit**

Run: `pnpm test test/auth-actions.test.ts` → Expected: PASS (3 tests).
Manually: sign in as each of the three (passwords from `db/seed/customers.ts`), confirm the nav flips to `Sign out`, sign out, confirm `/account` redirects to `/login`.

```bash
git add app/login app/signup components/brand/Nav.tsx test/auth-actions.test.ts
git commit -m "feat: add login, signup, and sign-out with opaque session cookies"
```

---

## Task 14: Cart and checkout

**Files:**
- Create: `app/cart/page.tsx`, `app/cart/actions.ts`
- Create: `app/checkout/page.tsx`, `app/checkout/actions.ts`
- Create: `app/checkout/confirmation/[orderNumber]/page.tsx`
- Test: `test/checkout-flow.test.ts`

**Interfaces:**
- Consumes: cart and orders services (Tasks 8, 9), `listAddresses` / `listPaymentMethods` (Task 10), `requireCustomer` (Task 6).
- Produces: `updateQuantityAction`, `removeItemAction`, `placeOrderAction(formData): Promise<{ error?: string }>`.

- [ ] **Step 1: Write `app/cart/page.tsx` and actions**

Line rows with a 64px thumbnail, Fraunces name, `Price`, a quantity stepper posting `updateQuantityAction`, and a `secondary` `Remove`. A sticky summary panel on the right shows subtotal, shipping (`Free` when zero), tax, and total, plus a `primary` `Proceed to checkout`. Empty cart renders a Fraunces `Your cart is empty` with a `secondary` link to `/shop`.

**Motion** — per the spec, motion is restricted to cart updates. Add `transition-opacity duration-200` on the summary panel keyed to a `useOptimistic` quantity so totals fade rather than jump. Nothing else animates.

- [ ] **Step 2: Write `app/checkout/actions.ts`**

```ts
'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireCustomer } from '@/lib/auth/session';
import { placeOrder } from '@/lib/services/orders';
import { PriceChangedError, ServiceError } from '@/lib/services/errors';

export async function placeOrderAction(
  _prev: { error?: string }, formData: FormData,
): Promise<{ error?: string }> {
  const customer = await requireCustomer();

  let orderNumber: number;
  try {
    const order = await placeOrder(customer.id, {
      addressId: Number(formData.get('addressId')),
      paymentMethodId: Number(formData.get('paymentMethodId')),
      // The total the customer was actually shown. placeOrder refuses to charge
      // anything else — see PriceChangedError.
      expectedTotalCents: Number(formData.get('expectedTotalCents')),
    });
    orderNumber = order.orderNumber;
  } catch (e) {
    if (e instanceof PriceChangedError) {
      revalidatePath('/checkout');
      return { error: 'Prices in your cart changed. Review the updated total and try again.' };
    }
    if (e instanceof ServiceError) return { error: e.message };
    throw e;
  }

  revalidatePath('/cart');
  revalidatePath('/orders');
  redirect(`/checkout/confirmation/${orderNumber}`);
}
```

- [ ] **Step 3: Write the checkout and confirmation pages**

Checkout: two columns. Left is address selection (radio cards from `listAddresses`, default preselected), payment selection (`listPaymentMethods`, showing `Visa ···· 4242`), and a `primary` `Place order`. Right is a read-only order summary with a hidden `expectedTotalCents` input carrying `getCart(...).totalCents`. Redirect to `/cart` when the cart is empty.

Confirmation: Fraunces `Order #10241 placed.`, the item list, the totals, the shipping address, and a `secondary` link to `/orders`. Call `getOrder(customer.id, orderNumber)` so another customer's confirmation 404s.

- [ ] **Step 4: Write the end-to-end flow test**

```ts
// test/checkout-flow.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { withTestDb, seedMinimal, type TestDb } from './harness';

let tdb: TestDb; let ids: Awaited<ReturnType<typeof seedMinimal>>;
vi.mock('@/db/client', () => ({ get db() { return (globalThis as any).__testDb; } }));
beforeEach(async () => {
  tdb = await withTestDb(); ids = await seedMinimal(tdb);
  (globalThis as any).__testDb = tdb.db;
});
afterEach(async () => { await tdb.close(); });

describe('browse to order', () => {
  it('completes the whole path and leaves consistent state', async () => {
    const { getProductBySlug } = await import('@/lib/services/catalog');
    const { addToCart, getCart } = await import('@/lib/services/cart');
    const { placeOrder, getOrder, listOrders } = await import('@/lib/services/orders');

    const product = await getProductBySlug('cascade-45l');
    await addToCart(ids.alice, product.id, 2);

    const cart = await getCart(ids.alice);
    expect(cart.totalCents).toBe(91140);

    const [addr] = await tdb.db.select().from(schema.addresses)
      .where(eq(schema.addresses.customerId, ids.alice));
    const [pm] = await tdb.db.select().from(schema.paymentMethods)
      .where(eq(schema.paymentMethods.customerId, ids.alice));

    const order = await placeOrder(ids.alice, {
      addressId: addr.id, paymentMethodId: pm.id,
      expectedTotalCents: cart.totalCents,
    });

    expect(order.totalCents).toBe(cart.totalCents);
    expect((await getCart(ids.alice)).items).toEqual([]);
    expect(await listOrders(ids.alice)).toHaveLength(1);

    const detail = await getOrder(ids.alice, order.orderNumber);
    expect(detail.items[0].nameSnapshot).toBe('Cascade 45L Expedition Pack');

    const [after] = await tdb.db.select().from(schema.products)
      .where(eq(schema.products.id, product.id));
    expect(after.stockQty).toBe(8);
  });

  it('does not let another customer read the confirmation', async () => {
    const { addToCart } = await import('@/lib/services/cart');
    const { placeOrder, getOrder } = await import('@/lib/services/orders');
    const { NotFoundError } = await import('@/lib/services/errors');
    const [addr] = await tdb.db.select().from(schema.addresses)
      .where(eq(schema.addresses.customerId, ids.alice));
    const [pm] = await tdb.db.select().from(schema.paymentMethods)
      .where(eq(schema.paymentMethods.customerId, ids.alice));

    await addToCart(ids.alice, ids.productIds[2], 1);
    const order = await placeOrder(ids.alice, { addressId: addr.id, paymentMethodId: pm.id });

    await expect(getOrder(ids.carol, order.orderNumber))
      .rejects.toBeInstanceOf(NotFoundError);
  });
});
```

- [ ] **Step 5: Verify and commit**

Run: `pnpm test test/checkout-flow.test.ts` → Expected: PASS (2 tests).
Manually: sign in as Alice, add two items, check out, confirm the confirmation reads **Order #10241** against the seeded database.

```bash
git add app/cart app/checkout test/checkout-flow.test.ts
git commit -m "feat: add cart, checkout, and order confirmation"
```

---

## Task 15: Orders and account pages

**Files:**
- Create: `app/orders/page.tsx`, `app/orders/[orderNumber]/page.tsx`
- Create: `app/account/page.tsx`, `app/account/actions.ts`
- Create: `app/account/addresses/page.tsx`, `app/account/payment-methods/page.tsx`
- Test: `test/account-pages.test.ts`

**Interfaces:**
- Consumes: `listOrders` / `getOrder` (Task 9), profile / addresses / paymentMethods services (Task 10), `requireCustomer` (Task 6).
- Produces: `updateProfileAction`, `saveAddressAction`, `deleteAddressAction`, `setDefaultAddressAction`, `addPaymentMethodAction`, `deletePaymentMethodAction`.

- [ ] **Step 1: Write the orders pages**

`/orders`: a table-ish list with `--rule` hairline separators — order number in tabular numerals, date, item count, status pill, total, and a `secondary` `View order`. Empty state offers a link to `/shop`.
`/orders/[orderNumber]`: `getOrder(customer.id, Number(params.orderNumber))`, wrapped so `NotFoundError` calls `notFound()`. Renders items with snapshot names and prices, the totals breakdown, the shipping address, and `Visa ···· 4242`.

Parse the route param defensively: `Number('abc')` is `NaN` and must render a 404, not a database error.

- [ ] **Step 2: Write the account pages**

`/account`: profile card (name editable, email read-only with a `Verified` / `Unverified` pill), plus links to addresses and payment methods.
`/account/addresses`: cards per address with `Default` badge, edit and delete, and an add form.
`/account/payment-methods`: cards showing brand, last four, and expiry, with add and delete. The add form collects **last four digits only** — there is no field for a full number, and a short comment says why.

Every action follows the Task 12 pattern: `requireCustomer()` → call the service → catch `ServiceError` into `{ error }` → `revalidatePath`.

- [ ] **Step 3: Write the test**

```ts
// test/account-pages.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { withTestDb, seedMinimal, type TestDb } from './harness';

let tdb: TestDb; let ids: Awaited<ReturnType<typeof seedMinimal>>;
vi.mock('@/db/client', () => ({ get db() { return (globalThis as any).__testDb; } }));
beforeEach(async () => {
  tdb = await withTestDb(); ids = await seedMinimal(tdb);
  (globalThis as any).__testDb = tdb.db;
});
afterEach(async () => { await tdb.close(); });

describe('account page data', () => {
  it('shows Bob as unverified and Alice as verified', async () => {
    const { getProfile } = await import('@/lib/services/profile');
    expect((await getProfile(ids.bob)).emailVerified).toBe(false);
    expect((await getProfile(ids.alice)).emailVerified).toBe(true);
  });

  it('treats a non-numeric order number as not found', async () => {
    const { getOrder } = await import('@/lib/services/orders');
    const { NotFoundError } = await import('@/lib/services/errors');
    await expect(getOrder(ids.alice, Number('abc'))).rejects.toBeInstanceOf(NotFoundError);
  });

  it('returns an empty order list for a customer with no orders', async () => {
    const { listOrders } = await import('@/lib/services/orders');
    expect(await listOrders(ids.bob)).toEqual([]);
  });
});
```

- [ ] **Step 4: Verify and commit**

Run: `pnpm test` → Expected: every suite PASS.
Manually: as Alice, confirm 8 seeded orders list with mixed statuses; open one; add and delete an address; confirm `/orders/abc` renders a 404 page.

```bash
git add app/orders app/account test/account-pages.test.ts
git commit -m "feat: add order history and account management pages"
```

---

## Task 16: README and final verification

**Files:**
- Modify: `README.md`
- Test: full suite plus a clean-clone rehearsal

**Interfaces:**
- Consumes: everything.
- Produces: a README covering only sub-project A. The full agent-facing README (agent recipes, ngrok, demo script) belongs to sub-project 10 and must not be written here.

- [ ] **Step 1: Write the README**

Sections: what Northbound is and that it is step 1 of a larger reference implementation; one-command setup (`pnpm install && pnpm db:setup && pnpm dev`); the three seeded accounts with their documented passwords and what each demonstrates — **Alice** verified with history, **Bob** unverified 2019 account whose password lives only in the simulated legacy backend, **Carol** Google signup who later set a password; a short architecture note on the service layer and why `/api/*` does not exist yet; and a **What is simplified** section listing no password reset, no email delivery, no rate limiting or lockout, no real payment processing, no inventory reservation, no shipping-rate calculation, and the Vercel/SQLite caveat with the `@libsql/client` escape hatch.

- [ ] **Step 2: Rehearse a cold clone**

```bash
cd $(mktemp -d) && git clone /Users/kevingao/b2c-agent-auth-sample-app nb && cd nb
git checkout northbound-storefront
pnpm install && pnpm db:setup && pnpm test
```

Expected: install succeeds, seed reports 8 categories / 64 products / 3 customers / 16 orders, and every test passes — **with no network access**, which is what the committed images buy.

- [ ] **Step 3: Confirm the boundaries actually hold**

```bash
# No agent, OAuth, actor, scope or policy vocabulary in the storefront.
grep -rniE '\b(oauth|bearer|access[_ ]token|actor|agent|scope|policy)\b' app/ lib/services/ components/ \
  | grep -v legacy-auth

# The legacy schema is imported by exactly one file.
grep -rn "schema/legacy" app/ lib/ components/
```

Expected: the first command prints nothing. The second prints exactly `app/legacy-auth/verify/route.ts`.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add sub-project A README with seeded accounts and setup"
```

---

## Self-review notes

**Spec coverage.** Every numbered section of the spec maps to a task: §3 data model → Tasks 2, 7, 10; §4 authentication → Tasks 4, 5, 6, 13; §5 service layer → Tasks 8, 9, 10; §6 security boundaries → comments in Tasks 2, 5, 6, plus the Task 16 grep; §7 routes → Tasks 12–15; §8 brand → Tasks 11, 12; §9 testing → Task 3 and every task's tests; §10 constraints → Task 1 (`.env.example`), Task 16 (README).

**Known soft spots for the implementer.**

- Task 7 pins only 8 of 64 photo IDs. Source the remaining 56 the same way and re-run `pnpm images:fetch` until it reports no `FAIL` lines.
- Task 7 lists 2 of 64 product literals. The bands, the per-category count, and the $900 two-item requirement are all enforced by `test/catalog-seed.test.ts`, so write products until that suite is green.
- Task 10 gives `paymentMethods.ts` as a schema plus a description rather than full source, because it is structurally identical to `addresses.ts`. Mirror that file.
- Tasks 12–15 specify page layout in prose rather than full JSX. The component contracts from Task 11 and the brand tokens from Task 1 are exact; the page composition is deliberately left to the implementer's judgment, and the tests assert data correctness rather than markup.

**Type consistency.** `CartView`, `CartLine`, `OrderSummary`, `OrderDetail`, `Profile`, `AddressInput`, `ProductFilters`, `PlaceOrderInput`, `VerifyResult` and the five `ServiceError` subclasses are each defined once, in the task that owns them, and referenced by name thereafter.
