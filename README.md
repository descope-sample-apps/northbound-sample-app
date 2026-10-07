# Northbound

A sample outdoor gear store: catalog, cart, checkout, order history, account pages, and email-and-password sign-in.

It's an ordinary store. It shows how [Agent Edge](https://github.com/descope/agent-edge) lets customers' AI agents shop for them with a Descope token, while the store itself barely changes.

![The Northbound storefront](docs/storefront.png)

## Run it

```bash
pnpm install && pnpm db:setup && pnpm dev
```

Open http://localhost:3000. It needs no configuration or external services.

## Sign in

| Email | Password |
| --- | --- |
| `alice@example.com` | `alpine-trail-2019` |
| `bob@example.com` | `northbound-legacy-99` |
| `carol@example.com` | `summit-ridge-4410` |

## AI agents

Agent Edge runs in front of the store and handles the agent side: recognizing agents, pointing them to the front door, getting the customer's approval through Descope, and blocking payment pages. Northbound's own sign-in, sessions, and pages are unchanged. It has two small additions:

- **It accepts the agent's Descope token.** [`lib/agentSession/descope.ts`](lib/agentSession/descope.ts) validates the token in the `DS` cookie, and the agent is signed in as the customer with the same email.
- **It asks for approval before an agent buys.** Agents connect read-only. At checkout, [`lib/agentSession/stepUp.ts`](lib/agentSession/stepUp.ts) sends an agent without `orders:write` to the front door's `/step-up` to approve that order.

To turn it on, set these in `.env.local` and run Agent Edge in front of the store. The [Agent Edge README](https://github.com/descope/agent-edge) has the setup.

| Variable | Value |
| --- | --- |
| `DESCOPE_DISCOVERY_URL` | Your Descope inbound app's Discovery URL |
| `FRONT_DOOR_URL` | The Agent Edge front door, for step-up |
| `STEP_UP_SECRET` | The same value as the front door's `STEP_UP_SECRET` |

## Deploy

SQLite on Vercel doesn't keep writes, so point `DATABASE_URL` at a hosted libsql database such as Turso before deploying.

## Scripts

| Command | Does |
| --- | --- |
| `pnpm dev` | Development server |
| `pnpm build` | Production build |
| `pnpm test` | Test suite |
| `pnpm db:setup` | Migrate and seed. Safe to re-run between demos. |
| `pnpm db:generate` | Regenerate migrations after a schema change |
