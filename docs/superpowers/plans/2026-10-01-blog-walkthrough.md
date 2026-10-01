# The Blog Walkthrough — design and plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Supersedes** tasks 5–10 of [the authorization-server plan](2026-09-22-authorization-server.md). Tasks 1–4 of that plan are done and still stand.

**Goal:** Make Northbound run the walkthrough in *Letting agents into your website without handing them the keys*, end to end, well enough to film: an agent identifies itself with Web Bot Auth, a policy picks a spending cap, the customer approves on their own device, the agent receives a delegated token, the backend enforces the cap, and an order over the threshold triggers a step-up.

**Spec:** the blog post is the specification. Where it conflicts with
[the original brief](../specs/2026-09-20-northbound-storefront-design.md) or
[the AS design](../specs/2026-09-22-authorization-server-design.md), **the blog wins**, and the conflict is recorded in §1.

---

## 1. Decisions and conflicts

| Question | Resolution | Source |
|---|---|---|
| Vertical | **Outdoor gear stays.** The blog's two "grocery"/"pantry" references get reworded instead. | User, 2026-10-01 |
| Identity provider | **Descope for real.** Local AS implements the same flows first so the repo is demonstrable before credentials land; `DescopeAuthorizationServer` then becomes real. | User |
| Web Bot Auth | **Northbound verifies** (RFC 9421) at its own edge and passes the resulting tier to Descope as a client tag / custom claim. Descope's Policies doc supports `client.tags` and custom JWT claims; it does not document RFC 9421 as an input. | User + [Policies](https://docs.descope.com/agentic-identity-hub/policies) |
| RAR | **Descope supports `authorization_details`**; docs lag. To be verified against the real project the moment credentials exist. If verification fails, Northbound derives the cap itself and the blog needs rewording — recorded here so it is not discovered silently. | User |
| RAR shape | **The blog's**, not the AS design's: `{"type":"purchase","max_amount":{"value":"200.00","currency":"USD"},"merchant":"northbound.example.com","period":"P7D"}`. Major-unit decimal **string** inside an object, not minor units. | Blog |
| Scope separator | **Colons** — `orders:read`, `cart:write`. The original brief used dots. Readers will diff the post against the repo. | Blog |
| `/api/agent/authorize` | Lives under `/api/*` as the blog says, and is **authenticated by Web Bot Auth, not by a bearer token**. The bearer-only rule becomes: resource endpoints require bearer; this one requires a valid HTTP Message Signature. The boundary test asserts both halves. | Blog + reconciliation |
| CIBA endpoint | `backchannel_authentication_endpoint` from the AS's own discovery document. Params `client_id`, `client_secret`, `scope`, `login_hint`, `binding_message`, `authorization_details`. Poll the token endpoint with `grant_type=urn:openid:params:grant-type:ciba` and `auth_req_id`. Pending states: `authorization_pending`, `slow_down`, `access_denied`, `expired_token`. | [Descope CIBA](https://www.descope.com/blog/post/ciba-ai-agents-hooks) |
| Deferred | Device code, MCP server, ID-JAG, token exchange, `/admin/*`, `external_identities`. None appear in the walkthrough. | — |

**Agent tiers and caps**, exactly as the blog's table:

| Tier | Cap |
|---|---|
| Verified, trusted platform | $200 / 7 days |
| Verified, unknown platform | $50 / 7 days |
| Unverified | Read-only, no purchases |

**Thresholds:** step-up when an order is ≥ $100 **or** ships to an address not used before. A $140 order passes under a $200 cap; $260 is refused with a 403 the agent can relay.

---

## 2. Review Focus

1. **A forged or replayed signature passes Web Bot Auth.** A signature over the wrong body, an expired `created`, a reused nonce, or a key fetched from an attacker-controlled URL must all fail — and failure must mean *unverified tier*, never *trusted*. → Task 2.
2. **The cap is read from the wrong place.** The limit must come from the token the customer approved, never from a request parameter, a header, or a database row the agent can influence. → Task 6.
3. **Step-up can be skipped.** An order ≥ $100 must not complete on the strength of the original grant, and the second approval must be bound to *that specific order* — approving one must not authorize another. → Task 7.
4. **The period window is ignored.** `period: P7D` means $200 across seven days, not $200 per order. Three $90 orders inside the window must exhaust it. → Task 6.
5. **An actor-bearing token reaches a forbidden endpoint.** Password and payment-method changes must refuse *any* token carrying `act`, regardless of scope. → Task 6.

---

## 3. Tasks

### Task 1 — RAR shape, scope separators, PRM

Align the vocabulary to the blog before anything is built on it.

- [ ] `lib/oauth/types.ts`: scopes become `products:read`, `orders:read`, `cart:read`, `cart:write`, `checkout`, `profile:read`, `addresses:write`, `payment_methods:write`.
- [ ] Replace `CheckoutAuthorizationDetail` with the blog's `PurchaseAuthorizationDetail`: `type: 'purchase'`, `max_amount: { value: string; currency: string }`, `merchant: string`, `period: string` (ISO 8601 duration). Add `parseMoneyValue(value: string): number` returning cents, and `parsePeriod(period: string): number` returning milliseconds — both with tests for malformed input, because these parse attacker-adjacent data.
- [ ] PRM gains `authorization_details_types_supported: ['purchase']`, matching the blog's JSON exactly.
- [ ] Update the existing JWT and discovery tests to the new vocabulary.

**Tests:** `"200.00"` → `20000`; `"0.5"` → `50`; `""`, `"abc"`, `"1e3"`, `"-5.00"`, `"200.123"` all rejected. `P7D` → 604800000; `P1W`, `PT1H`, `P30D` parse; `"7 days"`, `""`, `"P"` rejected.

### Task 2 — Web Bot Auth (RFC 9421)

**Files:** `lib/webbotauth/{verify,keys,tiers}.ts`, `scripts/sign-request.ts`, `test/fixtures/agent-keys/`

- [ ] `verifyHttpMessageSignature(request, opts)` parsing `Signature-Input` and `Signature`, rebuilding the signature base from the covered components (`@method`, `@target-uri`, `content-digest`, `@authority`), checking `created`/`expires` against a clock skew window, and verifying with Ed25519.
- [ ] Key resolution: fetch the caller's JWKS from `keyid`'s well-known URL, with an allowlist of trusted hosts loaded from `config/trusted-agent-platforms.json`. A fetch failure is `unverified`, never trusted.
- [ ] `classifyAgent(result) → 'verified-trusted' | 'verified-unknown' | 'unverified'` and the cap table.
- [ ] `pnpm agent:sign` signs an arbitrary request with a fixture key, so all three tiers are demonstrable offline.

**Tests (Review Focus 1):** valid signature from a trusted key → `verified-trusted`; valid signature from an untrusted-but-resolvable key → `verified-unknown`; no signature → `unverified`; **body tampered after signing → unverified**; `created` in the future or beyond skew → unverified; missing `content-digest` when the body is non-empty → unverified; `keyid` pointing at a host not on the allowlist → never `verified-trusted`.

### Task 3 — ActorContext through the services

Unchanged from the superseded plan's task 5. Mechanical signature refactor, no behaviour change, narrowed boundary test. This is the commit whose diff is the teaching artifact.

### Task 4 — `/agents`, `auth.md`, and the login-page link

- [ ] `app/agents/page.tsx` — branded, with the blog's visually-hidden `<section class="visually-hidden" aria-label="Instructions for AI agents">` block verbatim in substance, a "Connect your agent" button, and plain-language text a human can also read.
- [ ] `.visually-hidden` in `globals.css` — clip-rect, not `display:none`, so assistive tech and text-extracting agents still reach it.
- [ ] `app/auth.md/route.ts` and `app/.well-known/auth.md/route.ts` serving `text/markdown`, pointing at PRM as authoritative and labelled a compatibility layer.
- [ ] A "Signing in with an AI assistant?" link on `/login`.

**Tests:** both `auth.md` URLs return identical bodies with `content-type: text/markdown`; the body names the PRM URL and the `/api/agent/authorize` endpoint; `/agents` contains the hidden block and it is not `display:none`.

### Task 5 — CIBA

- [ ] Extend `AuthorizationServer` with `backchannelAuthorize(params)` and `pollToken(authReqId, client)`.
- [ ] `LocalAuthorizationServer`: issue `auth_req_id`, store the pending request with its `binding_message` and `authorization_details`, log the approval URL to the console as the blog's "SMS" stand-in, and honour `authorization_pending` / `slow_down` / `access_denied` / `expired_token`.
- [ ] `POST /api/agent/authorize` — verify Web Bot Auth, classify the tier, pick the cap, build the `authorization_details`, start CIBA, return `auth_req_id` and `interval`.
- [ ] Approval page: the customer signs in with their existing login, reads the binding message, approves or declines.

**Tests:** polling before approval returns `authorization_pending`; polling faster than `interval` returns `slow_down`; decline returns `access_denied`; expiry returns `expired_token`; the issued token carries `sub`, `act` and the approved `authorization_details`; **an unverified agent gets a read-only cap and no `purchase` detail at all.**

### Task 6 — Bearer API and the checkout guardrail

**Owns Review Focus 2, 4, 5.**

- [ ] `withBearer` as previously planned, plus the `/api/agent/authorize` exemption documented and tested.
- [ ] Resource routes for products, cart, orders, profile, addresses.
- [ ] Checkout compares the order total against the `max_amount` **from the token**, summed across orders already placed inside the `period` window. Over the cap → `403` with a body the agent can relay.
- [ ] Account-settings endpoints refuse any token carrying `act`, whatever its scope.

**Tests:** $140 under a $200 cap passes; $260 refused with 403; three $90 orders — third refused once the window is exhausted; a cap supplied in a header or query parameter is ignored; a token with `act` is refused by payment-method and password endpoints even holding `payment_methods:write`.

### Task 7 — Step-up

**Owns Review Focus 3.**

- [ ] Orders ≥ $100, or shipping to an address the customer has not used before, trigger a second CIBA request whose binding message names that order.
- [ ] Checkout returns `403` with `approval_id` and a verification URI; the agent polls; on approval the order completes.

**Tests:** a $160 order is held, not rejected; approving completes exactly that order; **approving order A does not authorize order B**; declining leaves the cart intact; a second order needs its own approval.

### Task 8 — Audit and the activity view

- [ ] Every write records customer id **and** agent id.
- [ ] `/account/activity` reading as prose: *"Shopping Assistant, acting on behalf of Alice, requested a $160 checkout. Alice approved. Order #10241 placed."* Direct customer actions appear in the same log with no actor.
- [ ] Per-agent view with a revoke button that actually revokes.

### Task 9 — Descope for real

Blocked on credentials in `.env.local`.

- [ ] Implement `DescopeAuthorizationServer` against the live project: discovery, CIBA backchannel, token polling, consent.
- [ ] **Verify `authorization_details` survives the round trip.** If it does not, stop and report — the blog's mechanism changes and so do several of its paragraphs.
- [ ] Pass the Web Bot Auth tier as a client tag or custom claim.
- [ ] README: both modes, and what each proves.

### Task 10 — README, demo script, test agent

- [ ] `scripts/test-agent.ts` driving the whole walkthrough from cold discovery.
- [ ] README demo script matching the blog beat for beat, and an explicit list of blog sentences that need rewording (the grocery references, and anything Task 9 disproves).

---

## 4. Self-review

**Blog coverage.** Web Bot Auth → T2; `/agents` + auth.md → T4; PRM → T1; CIBA → T5, T9; RAR → T1, T5, T6; consent + binding message → T5; token with `sub`/`act` → done in B/T1; backend enforcement → T6; step-up → T7; audit → T8; the three-tier table → T2, T5.

**Known soft spot.** Task 9 can invalidate Task 1's RAR decision. That is why T1 puts money and period parsing behind named functions with their own tests: if Descope cannot carry `authorization_details`, Northbound derives the same object itself and only the source changes, not the enforcement.
