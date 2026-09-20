# Northbound — Sub-project A: Storefront

**Status:** design approved, pending spec review
**Date:** 2026-09-20
**Scope:** Build-order step 1 of the B2C agent-auth reference implementation

---

## 1. Purpose

Northbound is an online outdoor gear and apparel retailer. Sub-project A builds it
as an ordinary B2C ecommerce site — catalog, cart, checkout, orders, account
management, email-and-password login — with **no agent concepts anywhere in the
code**.

That absence is the point. The parent project's thesis is that agent access is
*grafted onto* a retailer that already exists and already has users. If A ships
with agent scaffolding pre-installed, sub-project B's diff stops being a
demonstration of that grafting and becomes a demonstration of code we wrote in
anticipation of ourselves.

**Success criteria:**

1. `pnpm install && pnpm db:setup && pnpm dev` produces a working storefront with
   no configuration and no network access beyond the initial install.
2. Alice, Bob, and Carol can each log in with email and password, browse, add to
   cart, and place an order.
3. A reader who opens the repo sees a normal Next.js commerce app. Nothing in
   `app/` or `lib/services/` mentions OAuth, agents, actors, or scopes.
4. The test harness built here is the one every later sub-project's required
   tests run on.

**Non-goals for A:** any `/api/*` surface, any OAuth endpoint, `ActorContext`,
policy evaluation, audit logging, MCP. All deferred to B and later.

---

## 2. Decisions carried in from brainstorming

These were settled in conversation and are binding on implementation.

| Decision | Choice | Reasoning |
|---|---|---|
| Vertical | Outdoor gear & apparel, own-brand DTC | The parent spec's $100 policy threshold and $900 example basket are implausible in the originally-specified grocery catalog and natural here |
| Product variants | None — one SKU per product | Variants demonstrate nothing about OAuth and complicate the future `add_to_cart` tool contract |
| ORM | Drizzle | No codegen, no engine binary, migrations reviewable as plain SQL |
| DB driver | `@libsql/client` | Identical Drizzle code for a local file and for Turso; keeps Vercel deployability open without a later rewrite |
| Storefront auth | Email + password, all three users | User decision; per-user OTP/Google methods remain in the *authorization experience* in sub-project C |
| Bob's password | Lives only in the simulated legacy backend | Exercises `/legacy-auth/verify` from day one rather than first trying it in C |
| Sessions | Opaque DB-backed token in an httpOnly cookie | Makes revocation real in D, and makes the bearer-only rule structural rather than defensive (see §6) |
| Password hashing | `scrypt` from `node:crypto` | Zero dependency, no native build, nothing to break on Vercel |
| Signup | Included, minimal, excluded from the demo script | A B2C storefront with no "create account" link is conspicuous |
| Service layer signatures | `customerId` first, no `ActorContext` | `ActorContext` is introduced in B, as the agent-support commit |
| Product imagery | Pinned Unsplash photo IDs, fetched once, committed as WebP | `source.unsplash.com` returns 503 (retired); the `images.unsplash.com` CDN serves pinned IDs with no API key |

---

## 3. Data model

SQLite at `./data/northbound.db`. Migrations in `drizzle/` as plain SQL. The
database file is **not** committed — `pnpm db:setup` rebuilds it deterministically
from reviewable seed sources in `db/seed/*.ts`. A committed binary `.db` cannot be
code-reviewed and conflicts on every merge.

### 3.1 `customers`

```
id              integer primary key    -- 82731 / 19382 / 44102, seeded explicitly
email           text not null unique
name            text not null
email_verified  integer not null default 0
password_hash   text                   -- NULL for Bob; the legacy system owns his
auth_backend    text not null          -- 'local' | 'legacy'
signup_origin   text not null          -- 'web' | 'google'   (provenance, display only)
password_set_at integer                -- NULL if never set locally
created_at      integer not null
```

`auth_backend` is the dispatch discriminator. It is what lets the login handler
support Bob without special-casing him by email or id.

`signup_origin` is provenance only and has no behavioural effect in A. It exists
because sub-project C resolves Carol through a Google issuer, and seeding it now
avoids a migration later.

### 3.2 Seeded customers

| | id | `email_verified` | `auth_backend` | `signup_origin` | `created_at` | orders |
|---|---|---|---|---|---|---|
| Alice Chen | 82731 | true | `local` | web | 2021 | 8 |
| Bob Ferreira | 19382 | **false** | **`legacy`** | web | **2019** | 3 |
| Carol Nwosu | 44102 | true | `local` | **google** | 2023 | 5 |

Carol's `password_set_at` is seeded to 2024 — after her `created_at`. "Signed up
with Google in 2023" and "has a password" only cohere if she set one later, and
seed data that contradicts itself gets noticed in screenshots.

### 3.3 `legacy_credentials` — a deliberately separate system

```
legacy_user_id  integer primary key    -- the old system's own identifier
email           text not null
password_hash   text not null
created_at      integer not null       -- 2019, for Bob
```

**No foreign key to `customers`, on purpose.** This table simulates a 2019 auth
backend that Northbound does not own and cannot schema-migrate. It shares a SQLite
file with the rest of the app only because the parent spec forbids external
services.

Enforcement: it lives in its own Drizzle schema file (`db/schema/legacy.ts`), and
the **only** module permitted to import that schema is the `/legacy-auth/verify`
route handler. Every other caller — the storefront login action in A, the
authorization server in C — reaches it over HTTP.

### 3.4 Catalog

`categories` — 8 rows: Outerwear, Footwear, Packs & Bags, Shelter & Sleep,
Base Layers & Apparel, Camp Kitchen, Navigation & Light, Accessories.

`products` — 64 rows, 8 per category:

```
id, sku, slug, name, description, category_id,
price_cents, image_path, stock_qty, is_active, created_at
```

Price bands per category:

| Category | Range | | Category | Range |
|---|---|---|---|---|
| Outerwear | $120–650 | | Base Layers & Apparel | $28–175 |
| Footwear | $95–280 | | Camp Kitchen | $18–210 |
| Packs & Bags | $45–420 | | Navigation & Light | $24–380 |
| Shelter & Sleep | $85–850 | | Accessories | $16–195 |

$16–$850 overall. A meaningful number of SKUs sit on each side of the $100 line
that sub-project D's policy engine uses, and a $900 basket is two plausible items
(Cascade 45L Expedition Pack $420 + Ridgeline 3L Hardshell $480).

There is no `brand` column. Northbound is own-brand DTC, not a multi-brand
retailer.

### 3.5 Cart

`carts` — one open cart per customer. `cart_items` — `cart_id`, `product_id`,
`quantity`. **No price column**: a cart displays live price, and prices snapshot
only at order time.

### 3.6 Orders

```
orders       id, order_number (integer, distinct from PK), customer_id, status,
             placed_at, subtotal_cents, tax_cents, shipping_cents, total_cents,
             shipping_address_id, payment_method_id

             status ∈ 'placed' | 'shipped' | 'delivered' | 'cancelled'
             New orders are always 'placed'. Seeded history uses 'delivered'
             for anything older than 30 days and 'shipped' for the rest, so
             the order list shows more than one state.

order_items  id, order_id, product_id, name_snapshot, unit_price_cents,
             quantity, line_total_cents
```

`name_snapshot` and `unit_price_cents` exist so order history does not silently
rewrite itself when the catalog is edited.

**Seeded history:** 16 orders across six months, numbered **10225–10240**
(Alice 8, Carol 5, Bob 3). The first checkout performed in a demo is therefore
**#10241**, matching the audit-log example in the parent spec verbatim.

### 3.7 `addresses`, `payment_methods`

Per-customer, each with an `is_default` flag. Alice has 2 addresses and 2 cards;
Bob and Carol have 1 each.

`payment_methods` stores `brand`, `last4`, `exp_month`, `exp_year`,
`holder_name` only. **There is no column a real PAN could be written to.** This is
a schema-level constraint rather than a code comment on purpose.

### 3.8 `sessions`

```
id           text primary key   -- 32 random bytes, hex; this is the cookie value
customer_id  integer not null
created_at, expires_at, last_seen_at, revoked_at
user_agent   text
```

See §6 for why this is an opaque token and not a JWT.

---

## 4. Authentication

### 4.1 Login dispatch

One server action. Look up the customer by email, then dispatch on `auth_backend`:

```
'local'   → scrypt verify against customers.password_hash      (Alice, Carol)
'legacy'  → POST server-side to /legacy-auth/verify            (Bob)
```

Both branches return the same `{ ok, customerId }` shape, so the caller cannot
tell which backend answered. That is how a real retailer wraps a system
mid-migration.

When the email does not exist, the handler still performs a dummy scrypt hash
before returning failure. An authentication reference implementation that leaks
user existence through response timing undermines its own credibility.

`verifyCredentials()` is extracted as a standalone function because sub-project C's
authorization experience calls the same logic. This is genuine shared auth code,
not agent scaffolding leaking into A.

### 4.2 `/legacy-auth/verify`

```
POST /legacy-auth/verify
  X-Legacy-Service-Token: <shared secret; .env.example only>
  { email, password } → { ok: true, legacy_user_id } | { ok: false }
```

Server-to-server only, enforced by the token header. The browser never calls it.

This route carries the heaviest security comment in the repository, because it is
the concrete instance of the project's thesis:

> The password is typed into Northbound's own form, posted to Northbound's own
> server, and forwarded to the legacy backend over a server-side channel. It never
> transits an agent, and in sub-project C it never transits the OAuth client.

The comment names this as the **Descope Generic HTTP Connector pattern**, as the
parent spec requires.

### 4.3 Sessions

`getCurrentCustomer()`, wrapped in React's `cache()` for per-request memoization.

**Not Next.js middleware.** Middleware runs on the edge runtime and cannot open a
SQLite handle, so session validation happens in server components and route
handlers. Recording this here because it is the kind of constraint that is
otherwise discovered three days in.

Cookie `nb_session`: `httpOnly`, `sameSite=lax`, `secure` in production. Logout
sets `revoked_at` **and** clears the cookie, so a stolen cookie dies server-side.

### 4.4 Signup

Minimal: email, name, password. Writes a customer with `auth_backend='local'`,
`signup_origin='web'`, `email_verified=0`. Not referenced by the demo script.

---

## 5. Service layer

### 5.1 The four rules

1. **Services are the only code that touches Drizzle.** Server components do not
   query directly. If pages can reach the database, A's rendering path and B's
   `/api/*` will drift, and the "same boundary, different actor" claim quietly
   becomes false.
2. **`customerId` is the first argument and every query is scoped by it.** No
   service function can read another customer's row. In A this is ordinary
   correctness; in B it is the IDOR protection the agent API inherits for free.
3. **Zod validation at the service boundary, not in server actions.** Validation
   placed in the action would not apply to B's API callers.
4. **Services throw typed errors** — `NotFoundError`, `OwnershipError`,
   `OutOfStockError`, `ValidationError` — and never return HTTP concepts. A maps
   them to form errors; B maps them to status codes.

### 5.2 Modules

`lib/services/{catalog,cart,orders,profile,addresses,paymentMethods}.ts`

| Function | Future scope (B) | Future MCP tool (E) |
|---|---|---|
| `searchProducts(filters)` | `products.read` | `search_products` |
| `getProductBySlug(slug)` | `products.read` | — |
| `getCart(customerId)` | `cart.read` | `get_cart` |
| `addToCart` / `updateCartItem` / `removeFromCart` | `cart.write` | `add_to_cart`, `remove_from_cart` |
| `placeOrder(customerId, input)` | `checkout` | `checkout` |
| `listOrders` / `getOrder` | `orders.read` | `list_orders`, `get_order` |
| `getProfile` | `profile.read` | `get_profile` |
| `updateProfile` | **none — see note** | — |
| `listAddresses` / `upsertAddress` / `deleteAddress` | `addresses.write` | `update_address` |
| `listPaymentMethods` / `addPaymentMethod` / `deletePaymentMethod` | `payment_methods.write` | — |

Every scope and every MCP tool in the parent spec has exactly one home, and
nothing is orphaned. `addPaymentMethod` deliberately has no MCP tool — sub-project
D denies agents that action outright, so exposing a tool for it would be
misleading.

**This table is forward-looking documentation, not code.** No scope or tool name
appears in A's source.

**Note on `updateProfile`:** the parent spec's scope list contains `profile.read`
but no corresponding write scope, and its MCP tool list contains `get_profile` but
no `update_profile`. Agents therefore cannot change a customer's name or email by
design. `updateProfile` exists in A as a browser-only operation. If a write scope
is wanted later it must be added to the parent spec deliberately — it should not
be invented during implementation.

### 5.3 `placeOrder`

One libsql transaction: load cart → assert non-empty → assert the address and
payment method belong to this customer → snapshot names and prices → check and
decrement stock → allocate `order_number` as `max+1` → insert order and items →
clear cart. Rolls back as a unit.

Money, evaluated in this order: `subtotal_cents` is the sum of line totals;
shipping is **$0 when `subtotal_cents >= 7500`, otherwise $895**; tax is **8.5% of
`subtotal_cents`** (not of shipping); `total_cents = subtotal + shipping + tax`.
Deterministic and boring on purpose — and stated as an ordered calculation because
"free over $75" is ambiguous about which figure it tests.

**Binding decision for sub-project D:** the "amount" that the policy engine and
the RAR `maximum_amount` ceiling both compare against is **`total_cents`** — what
the customer is actually charged, tax and shipping included. Without this, a $96
subtotal becomes a $104 total and the two checks can disagree about whether the
$100 threshold was crossed.

---

## 6. Security boundaries

Three boundaries get explicit comments in A, because later sub-projects depend on
them holding.

**6.1 Where the credential is entered.** `/login` and the legacy verify route.
Commented as described in §4.2.

**6.2 Why the session cookie is opaque.** `sessions.id` is 32 random bytes. It
carries no claims, no signature, and no meaning outside the `sessions` table.

This is a structural answer to the parent spec's hard requirement that `/api/*`
must never accept the browser session. A JWT session cookie would be *shaped* like
a bearer token, and the only thing stopping someone presenting it to the API would
be a check that a future contributor might not think to preserve. An opaque
database token is **incapable** of being validated as an access token by any code
path, including code written by someone who never read the test.

**6.3 Ownership scoping.** Rule 2 of §5.1. Commented at the service layer as the
single place customer isolation is enforced.

---

## 7. Routes

```
/                              editorial landing
/shop  ·  /shop/[category]     listing with filters and sort
/product/[slug]                product detail
/cart
/checkout  ·  /checkout/confirmation/[orderNumber]
/orders  ·  /orders/[orderNumber]
/account  ·  /account/addresses  ·  /account/payment-methods
/login  ·  /signup

/legacy-auth/verify            route handler, server-to-server only
```

`/legacy-auth/verify` is the only HTTP endpoint A ships, and it is deliberately
**not** under `/api/*`, so it never collides with the bearer-only rule B enforces.

Mutations are server actions colocated in `app/**/actions.ts`. Each performs the
same three steps: resolve session → call service → `revalidatePath`.

---

## 8. Brand and design system

### 8.1 Palette

```
--paper    #FBF7F0   warm cream, page background
--surface  #FFFFFF   cards, panels
--ink      #1B2620   text, structural rules
--spruce   #2E5A4B   primary brand, filled actions
--ember    #C0572F   accent; actions and signals only
--muted    #7A8479   secondary text, labels
--rule     #E3DCCD   hairlines
```

Ember is scarce by policy — eyebrow labels and secondary actions only. It loses
its signal value if it becomes decorative.

### 8.2 Typography

- **Fraunces** — display serif. Headings, product names, the wordmark.
  `SOFT 20–30`, `WONK 1` on the wordmark.
- **Figtree** — UI sans. Body, navigation, controls, prices.

Two families, both via `next/font/google`. No system font stack, per the parent
spec.

### 8.3 Chrome

Navigation takes its structure from brainstorming direction B: uppercase links at
11px with `0.11em` letterspacing, and a **2px solid ink bottom rule**. The
wordmark stays Fraunces in spruce. The structure comes from CSS treatment, not
from a third typeface.

### 8.4 Buttons — three roles

| Role | Treatment | Used for |
|---|---|---|
| **Primary** | Filled spruce, 3px radius, uppercase 11px, `0.11em` tracking | The main action on a surface |
| **Secondary** | *Editorial rule* — small-caps ember, short underline that draws to full width on hover | Browsing and navigation away from the current surface |
| **Tertiary** | *Ghost outline* — hairline spruce, fills on hover, sized to match Primary | **Decision pairs only** |

The primary button's 3px radius and letterspacing deliberately echo the 2px nav
rule; a soft rounded button under a hard architectural rule is what made the
original treatment read as dated.

**The tertiary role exists for sub-project C.** The consent screen needs an
Approve/Deny pair in which Deny carries real weight. A text-style secondary cannot
do that job, so the ghost outline is defined here — as part of one coherent system
— rather than invented under deadline in C. It is reserved for consent screens,
approval prompts, and destructive confirmations. It does not appear in A's
storefront.

### 8.5 Motion

Per the parent spec, subtle and restricted to cart updates and (later) approval
state changes. Hover transitions on buttons are 180–280ms with
`cubic-bezier(.4,0,.2,1)`.

### 8.6 Product imagery

`source.unsplash.com` has been retired and returns 503. The workable approach,
verified during design:

1. 64 Unsplash photo IDs are pinned in `db/seed/images.ts`, one per SKU.
2. `pnpm images:fetch` downloads each from `images.unsplash.com` (no API key
   required), converts to WebP at 800px, and writes to `public/products/`.
3. The WebP files are **committed**. Roughly 3–5MB.

Committed images mean a cold clone demos correctly with no network and no rate
limit. Attribution for each photo is recorded in `public/products/CREDITS.md`.

---

## 9. Testing

Vitest. A harness in `test/harness.ts` spins a fresh temporary libsql database and
seeds it per suite.

**The harness is the most important deliverable in this section.** Every required
test in sub-projects B through E — bearer-only enforcement, PKCE required, token
audience validation, ID-JAG issuer validation, the policy truth table, linking
surviving an email change — runs on it. It is worth slightly over-building now.

A's own tests:

| Test | Asserts |
|---|---|
| Login dispatch, local | Alice and Carol authenticate against `password_hash` |
| Login dispatch, legacy | Bob authenticates via `/legacy-auth/verify`; `customers.password_hash` stays NULL |
| Legacy route guard | `/legacy-auth/verify` rejects requests without `X-Legacy-Service-Token` |
| Unknown email timing | Failure path runs a dummy hash; no early return |
| Session lifecycle | Create, read, expire, revoke; revoked sessions fail closed |
| Cart math | Quantities, line totals, live pricing |
| `placeOrder` transaction | Stock decremented, numbering correct, cart cleared, full rollback on failure |
| **Ownership scoping** | Carol cannot read Alice's order, address, or payment method |

The ownership test is the ancestor of every authorization test in this repository.

---

## 10. Known constraints and deferred items

**Blocking, must be resolved before implementation:** `pnpm` is not currently
functional on this machine. Node is v24.18.0, but corepack's shim points at a
pnpm 12.5.1 cache entry that does not exist. The parent spec requires a single
`pnpm dev`, so this is fixed first.

**SQLite and Vercel conflict.** The parent spec asks for file-backed SQLite *and*
Vercel deployability. Vercel's filesystem is ephemeral, so a hosted demo would
lose carts and orders on instance recycle. Using `@libsql/client` means the same
Drizzle code runs against a local file by default and against Turso by changing
one environment variable. A ships the local-file configuration; the README
documents the limitation.

**Deferred to later sub-projects, recorded here so they are not re-litigated:**

- `ActorContext` enters the service signatures in B, not A.
- RAR `maximum_amount` should be a string in minor units (`"10000"`), not a bare
  integer. RFC 9396 leaves these fields to the implementer, so this is an
  extension and must be labelled as one in code and in the README.
- The policy engine's "amount" is `total_cents` (§5.3).

**Simplified for the demo, for the README's "what is simplified" section:**
no password reset, no email delivery, no login rate limiting or lockout, no real
payment processing, no inventory reservation, no shipping-rate calculation.

---

## 11. Open questions

None. All design questions were resolved during brainstorming.
