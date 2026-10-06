# Northbound

An outdoor gear and apparel retailer. Catalog, cart, checkout, order history,
account management, email-and-password sign-in.

This is **sub-project A** of a reference implementation demonstrating secure AI
agent access to existing user accounts. On its own it is deliberately
unremarkable: an ordinary B2C storefront with **no agent or OAuth concepts
anywhere in the code**.

That absence is the point. The thesis of the wider project is that agent access
is *grafted onto* a retailer that already exists and already has customers. If
this storefront shipped with agent scaffolding pre-installed, the commit that
adds agent support would stop demonstrating the graft and start demonstrating
code written in anticipation of itself. A test enforces this
([`test/boundaries.test.ts`](test/boundaries.test.ts)) rather than a promise.

---

## Setup

```bash
pnpm install && pnpm db:setup && pnpm dev
```

No configuration, no external services, no network access required. Product
photography is committed to the repository, so a cold clone works offline.

Optional: `cp .env.example .env.local`. Every value has a working default.

---

## AI agents, through agent-ready

This branch lets customers' AI agents shop for them, and the store itself barely
changes. A Cloudflare Worker from [agent-ready](https://github.com/descope/agent-ready)
sits in front of it and does nearly everything:

- **Recognizes agents**, by Web Bot Auth signature, user agent, or the session cookie below.
- **Serves the discovery files** agents look for: `/.well-known/oauth-protected-resource`, `/auth.md` and `/agents`.
- **Shows agents the way in.** It adds a note for agents to `/login`, and sends recognized agents there to the front door.
- **Blocks agents from payment methods** (`BLOCKED_AGENT_PATHS = "/account/payment-methods*"`).
- **Logs every agent request** with the agent's identity.

The agent-ready front door asks the customer to approve the agent through Descope
CIBA, then puts the Descope access token in a `DS` cookie in the agent's browser.

**Northbound's only change is accepting that token:**
[`lib/agentSession/descope.ts`](lib/agentSession/descope.ts) checks it against the
Descope inbound app, and [`lib/auth/session-cookie.ts`](lib/auth/session-cookie.ts)
uses it to sign the agent in as the customer with the same email. A customer's
own session always wins. The boundary test keeps agent code confined to those two files.

### Run it

1. In Descope, create users with the seeded emails (`alice@example.com` and so
   on), and an inbound app with CIBA turned on whose tokens include `email` and `act`.
2. Set `DESCOPE_DISCOVERY_URL` in `.env.local` to the inbound app's Discovery
   URL, then `pnpm dev` (port 3000).
3. Start the [demo front door](https://github.com/descope/agent-ready/tree/main/demo/front-door)
   on port 8788, with `COOKIE_DOMAIN` unset.
4. Start the Worker in front of Northbound:

   ```bash
   cd agent-ready/cloudflare
   npx wrangler dev --var UPSTREAM_ORIGIN:http://localhost:3000 --var MODE:route \
     --var FRONT_DOOR_URL:http://localhost:8788 --var LOGIN_PATHS:/login \
     --var BLOCKED_AGENT_PATHS:"/account/payment-methods*" --var SITE_NAME:Northbound \
     --var HINT_SIGNING_SECRET:<same as the front door>
   ```

5. Browse to `http://localhost:8787` as the agent. Cookies ignore ports, so the
   front door's cookie on `localhost:8788` reaches Northbound through the Worker
   on `localhost:8787`.

---

## Seeded accounts

| Email | Password | What it demonstrates |
| --- | --- | --- |
| `alice@example.com` | `alpine-trail-2019` | The ordinary case. Verified email, eight orders, two addresses, two cards. |
| `bob@example.com` | `northbound-legacy-99` | **A 2019 account whose password Northbound does not hold.** `customers.password_hash` is `NULL`; the credential lives only in a simulated legacy backend. Email never verified. |
| `carol@example.com` | `summit-ridge-4410` | Signed up with Google in 2023 and set a password in 2024. Her `signup_origin` is `google`, which matters once identity linking exists. |

Bob is the interesting one. Signing in as him exercises
[`/legacy-auth/verify`](app/legacy-auth/verify/route.ts), a stand-in for an
authentication service the retailer does not own and cannot schema-migrate.

---

## Architecture

**`lib/services/*` is the only code that touches the database.** Every service
function takes `customerId` as its first argument and scopes every query by it,
so one customer structurally cannot read another's rows. Validation is Zod, at
the service boundary rather than in server actions. Services throw typed errors
(`NotFoundError`, `OwnershipError`, `OutOfStockError`, `ValidationError`,
`PriceChangedError`) and never return HTTP concepts.

This matters for what comes next. When an agent API and an MCP server are added,
they call the *same* functions rather than reimplementing them, which is what
makes "the application decides what the agent may do" true in code rather than
in a diagram.

**There is no `/api/*` surface yet.** The only HTTP route this app exposes is
`/legacy-auth/verify`, and it is deliberately not under `/api`, so it will never
collide with the bearer-only rule that namespace is going to enforce.

### Three security boundaries, commented in the source

1. **Where the credential is entered** — [`app/login/actions.ts`](app/login/actions.ts)
   and [`lib/auth/verify.ts`](lib/auth/verify.ts). The password arrives from
   Northbound's own form and is either checked locally or handed to the legacy
   service. It is never stored, logged, or exposed to any client. This is the
   Descope Generic HTTP Connector pattern.

   By default that hand-off is an in-process call, so the app runs as a single
   service with nothing else to start. Set `LEGACY_AUTH_URL` (see
   [`.env.example`](.env.example)) to make it a real server-to-server HTTP
   request — worth doing when you want the boundary visible on a request trace.
   Either way the credential stays server-side; the env var changes whether the
   hop is observable, not whether it is safe.

2. **Why the session cookie is opaque** — [`lib/auth/session.ts`](lib/auth/session.ts).
   `nb_session` is 32 random bytes with no claims and no signature, meaningless
   outside the `sessions` table. A JWT session cookie would be *shaped* like a
   bearer token: generic middleware that verifies a signature would accept it,
   and only a deliberate check would stop it reaching an API. This value cannot
   be validated by inspection at all.

   To be precise about what that buys: it does not make presenting a session to
   an API impossible — `resolveSession` is exported and would answer if some
   future handler called it. It makes doing so an explicit act rather than an
   accident of shape, which is why access tokens will live in their own table
   with their own resolver.

3. **Ownership scoping** — every service function. The ancestor of every
   authorization test this project will need.

### Stack

Next.js 16 (App Router), TypeScript, Tailwind v4, Drizzle ORM over
`@libsql/client`, Zod, Vitest. Fraunces and Figtree via `next/font/google`.

---

## Testing

```bash
pnpm test
```

197 tests across 21 files. Beyond the ordinary coverage, these are the ones
worth knowing about:

| Test | What it pins down |
| --- | --- |
| `boundaries.test.ts` | No OAuth/agent/scope vocabulary anywhere in `app/`, `lib/` or `components/`; the legacy schema has exactly one importer and exactly one in-process caller; only services import the database client; nothing anywhere can hold a card number |
| `concurrency-constraints.test.ts` | Simultaneous checkouts by unrelated customers all succeed instead of one dying on a database lock; deleting an address or card a past order used is refused with a readable reason rather than a constraint error; a customer's first cart read survives the layout and the page racing each other |
| `services-orders.test.ts` | Concurrent checkout cannot oversell the last unit or issue a duplicate order number |
| `services-orders.test.ts` | A product deactivated or sold out *after* being added to a cart fails checkout by name, not with a 500 |
| `services-orders.test.ts` | A price that moves between display and checkout raises `PriceChangedError` instead of silently charging a different total |
| `session.test.ts` | Expired and revoked sessions fail closed |
| `services-cart.test.ts` | `0`, `-3`, `2.5`, `NaN`, `Infinity` and `999999` are all rejected at the service boundary |
| `seed.test.ts` | The next order placed is **#10241** |

---

## What is simplified for the demo

- **No password reset and no email delivery.** Verification status is seed data.
- **No rate limiting or account lockout** on sign-in. The dummy-hash path means
  failures cost the same time whether or not the account exists, so response
  timing does not enumerate accounts — but nothing stops repeated attempts.
- **No payment processing.** Cards are brand, last four, and expiry. Nothing is
  charged, and there is no column a real number could be written to.
- **No inventory reservation.** Stock decrements at checkout inside a
  transaction; it is not held while a cart sits open.
- **No shipping-rate calculation.** Flat $8.95, free over $75.
- **Demo passwords are in the repository**, in this file and in
  [`db/seed/customers.ts`](db/seed/customers.ts). Obviously do not do this
  anywhere real.
- **SQLite on Vercel will not persist writes.** Vercel's filesystem is
  ephemeral, so a hosted demo would lose carts and orders on instance recycle.
  `@libsql/client` is used precisely so that pointing `DATABASE_URL` at a hosted
  libsql (Turso) is a one-variable change with no code edits.

---

## Scripts

| Command | Effect |
| --- | --- |
| `pnpm dev` | Development server |
| `pnpm build` | Production build |
| `pnpm test` | Full test suite |
| `pnpm db:setup` | Migrate and seed — idempotent, safe to re-run between demos |
| `pnpm db:generate` | Regenerate migrations after a schema change |
| `pnpm images:fetch` | Re-download product photography; skips files already present |

Product photography comes from [Unsplash](https://unsplash.com) under the
Unsplash License. Per-image attribution is in
[`public/products/CREDITS.md`](public/products/CREDITS.md).

---

## What comes next

Sub-projects B through E add discovery metadata and a local authorization
server, authentication and identity linking, a policy engine with an approval
flow, an audit log, and an MCP server — each on top of the service layer this
one establishes. None of them belongs in this README; each gets its own spec and
plan.
