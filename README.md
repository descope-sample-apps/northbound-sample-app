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

- **It accepts the agent's Descope token.** [`lib/agentSession/descope.ts`](lib/agentSession/descope.ts) validates the token in the `DS` cookie, and the agent is signed in as the customer with the same email. The token must carry `orders:read` or `orders:write`, the access the customer approved.
- **It asks for approval before an agent buys.** Agents connect read-only. At checkout, [`lib/agentSession/stepUp.ts`](lib/agentSession/stepUp.ts) sends an agent without `orders:write` to the front door's `/step-up` to approve that order.

To turn it on, set these in `.env.local` and run Agent Edge in front of the store. The [Agent Edge README](https://github.com/descope/agent-edge) has the setup.

| Variable | Value |
| --- | --- |
| `DESCOPE_DISCOVERY_URL` | Your Descope inbound app's Discovery URL |
| `DESCOPE_AUDIENCE` | The Descope resource the agent's token must be issued for, such as `https://northbound.camp/agent_resource`. Tokens for any other audience are rejected. Use the same value as the front door's `RESOURCE`. |
| `FRONT_DOOR_URL` | The Agent Edge front door, for step-up |
| `STEP_UP_SECRET` | The same value as the front door's `STEP_UP_SECRET` |
| `DEMO_AUTO_SIGNUP` | `true` creates an account, with a sample address and test card, the first time someone approves an agent with a new email. For demos. |

> [!NOTE]
> **Optional: approve agents with a Northbound login.** By default, customers approve an agent by signing in through Descope, with a one-time code sent to their email or a social login such as Google, so you don't need anything here. To show customers approving with the Northbound account they already have, add Descope's External Authentication action to the approval flow with `https://<your site>/login` as its URL, and set `DESCOPE_PROJECT_ID` and `DESCOPE_MANAGEMENT_KEY`. Northbound then signs the customer in and tells Descope who they are ([`lib/agentSession/externalAuth.ts`](lib/agentSession/externalAuth.ts)).

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
