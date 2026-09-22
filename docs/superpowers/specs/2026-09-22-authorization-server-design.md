# Northbound — Sub-project B: Authorization server and bearer-only API

**Status:** design written, pending review
**Date:** 2026-09-22
**Scope:** Parent build-order steps 2 and 5, plus the consent screen from step 3
**Builds on:** [Sub-project A](2026-09-20-northbound-storefront-design.md)

---

## 1. Purpose

Sub-project A is a retailer that works and has customers. B grafts agent access
onto it, through a standards-based OAuth boundary, without creating a parallel
account system and without handing any agent a browser session.

**The commit range this produces is the teaching artifact.** A reader should be
able to `git diff` A..B and see exactly what it costs to add agent support to an
application that already exists. That is why A was built with no agent
vocabulary in it, and why `ActorContext` is introduced here rather than there.

**Success criteria:**

1. A third-party agent with no hardcoded knowledge of Northbound can: call
   `/api/orders`, read the `401` + `WWW-Authenticate`, fetch Protected Resource
   Metadata, fetch authorization-server metadata, dynamically register, run
   authorization code + PKCE, obtain a token, and retry successfully.
2. Every issued access token names **both** identities: the customer in `sub`,
   the agent in `act.sub`.
3. `/api/*` accepts bearer tokens only. A request carrying a valid `nb_session`
   cookie and nothing else gets `401`. A test asserts this.
4. The storefront still works exactly as it did, and its pages still contain no
   OAuth vocabulary.

**Non-goals for B:** device authorization grant, CIBA, token exchange, ID-JAG,
policy engine, approval flow, audit log, MCP server. All deferred.

---

## 2. Decisions made while writing this spec

No question in this section was left open; each is recorded with its reasoning
so it can be overturned deliberately rather than discovered later.

| Decision | Choice | Reasoning |
|---|---|---|
| Token signature | **RS256**, with a JWKS endpoint | An agent and any future resource server must verify without a shared secret. RFC 9728 discovery expects a published key set, and step 9's ID-JAG consumption needs JWKS validation machinery anyway — building it once, here, is cheaper than twice. |
| Key material | Generated on first run into `data/keys.json`, gitignored | The parent spec forbids secrets in the repo. A committed dev key is a secret in the repo. Generation is deterministic to operate and invisible to the user. |
| Issuer / base URL | Derived from the request `Host`, overridable by `NORTHBOUND_ISSUER` | Redirect URIs, `iss`, and `resource_metadata` must all agree with the host the agent actually reached. Deriving from the request makes `ngrok http 3000` work with no configuration; the env var exists for deployments behind a proxy that rewrites Host. |
| Access token lifetime | 15 minutes, per the parent spec | — |
| Refresh tokens | Rotate on every use; the superseded token is revoked | Parent spec requires rotation. Reuse of a rotated token revokes the whole chain, which is the standard detection response to a stolen refresh token. |
| Token storage | Access tokens are stateless JWTs; a record row is kept per issuance | `/oauth/introspect` and `/oauth/revoke` cannot answer honestly about a purely stateless token. The row is the revocation list; the JWT is still self-verifiable for the fast path. |
| `ActorContext` | Introduced here, threaded through every service | Recorded as deferred in the A spec. TypeScript makes the refactor exhaustive. |
| RAR `maximum_amount` | String, in minor units (`"10000"`) | RFC 9396 leaves non-standard fields to the implementer. A bare integer is ambiguous about units. **This is an extension and is labelled as one** in the code and in `auth.md`. |
| Consent screen | Built in B | The authorization code flow is meaningless without one, and it is the artifact most likely to be screenshotted. Sub-project C enriches its authentication half; the consent half is settled here. |
| Device code, CIBA, token exchange, ID-JAG | Deferred | Each is a distinct grant with its own failure modes. Shipping the code flow end to end first gives every later grant a working token endpoint to reuse. |

---

## 3. What the agent sees first: discovery

### 3.1 Protected Resource Metadata — RFC 9728

`GET /.well-known/oauth-protected-resource`

```json
{
  "resource": "https://<host>/api",
  "authorization_servers": ["https://<host>"],
  "scopes_supported": ["products.read", "orders.read", "cart.read",
                       "cart.write", "checkout", "profile.read",
                       "addresses.write", "payment_methods.write"],
  "bearer_methods_supported": ["header"]
}
```

`bearer_methods_supported` is `["header"]` only. Accepting a token in a query
string would put it in access logs and browser history, and this application has
no reason to.

### 3.2 The challenge

**Every** `401` from `/api/*` carries:

```
WWW-Authenticate: Bearer realm="Northbound",
  error="invalid_token",
  error_description="...",
  resource_metadata="https://<host>/.well-known/oauth-protected-resource"
```

This is the only thing standing between "an agent that has never heard of
Northbound" and "an agent holding a valid token". It is generated in one place
([§6.3](#63-the-bearer-guard)) so it cannot drift between routes.

### 3.3 Authorization server metadata — RFC 8414

`GET /.well-known/oauth-authorization-server` advertises `issuer`,
`authorization_endpoint`, `token_endpoint`, `registration_endpoint`,
`revocation_endpoint`, `introspection_endpoint`, `jwks_uri`,
`scopes_supported`, `response_types_supported: ["code"]`,
`grant_types_supported: ["authorization_code", "refresh_token"]`,
`code_challenge_methods_supported: ["S256"]`, and
`authorization_details_types_supported: ["checkout"]`.

**`S256` only.** `plain` is not advertised and is rejected if attempted.

`GET /.well-known/jwks.json` publishes the public key.

---

## 4. The `AuthorizationServer` interface

The parent spec is explicit: *one module, one interface, no AS logic scattered
through route handlers.*

```ts
interface AuthorizationServer {
  metadata(issuer: string): AuthorizationServerMetadata;
  registerClient(request: ClientRegistrationRequest): Promise<RegisteredClient>;
  getClient(clientId: string): Promise<RegisteredClient | null>;

  createAuthorizationRequest(params: AuthorizeParams): Promise<AuthorizationRequest>;
  completeAuthorization(requestId: string, customerId: number): Promise<{ code: string; redirectUri: string; state?: string }>;

  exchangeCode(params: CodeExchangeParams): Promise<TokenResponse>;
  refresh(params: RefreshParams): Promise<TokenResponse>;

  introspect(token: string): Promise<IntrospectionResponse>;
  revoke(token: string): Promise<void>;

  verifyAccessToken(token: string, expectedAudience: string): Promise<AccessTokenClaims>;
}
```

Two implementations:

- **`LocalAuthorizationServer`** — the default. No configuration, works offline.
- **`DescopeAuthorizationServer`** — a stub selected when `DESCOPE_PROJECT_ID`
  is set. Every method throws `NotImplementedError` with a TODO naming the
  Descope API that would back it. It exists so the seam is real and visible, not
  to pretend it works.

Route handlers under `/oauth/*` contain HTTP parsing and nothing else.

---

## 5. Data model additions

```
agents
  id            text primary key      -- 'agent_shopping_assistant'
  display_name  text not null
  logo_path     text
  owner         text not null         -- the organisation behind the agent
  description   text
  created_at    integer not null

oauth_clients                          -- RFC 7591 dynamic registration
  client_id                text primary key
  client_secret_hash       text        -- NULL for public clients
  agent_id                 text references agents(id)
  client_name              text not null
  logo_uri                 text
  redirect_uris            text not null   -- JSON array
  grant_types              text not null   -- JSON array
  token_endpoint_auth_method text not null -- 'none' | 'client_secret_basic'
  scope                    text
  created_at               integer not null

authorization_requests                 -- short-lived, pre-consent
  id, client_id, customer_id, redirect_uri, scope, state,
  code_challenge, code_challenge_method, authorization_details,
  resource, created_at, expires_at, approved_at

authorization_codes
  code_hash, request_id, client_id, customer_id, scope,
  code_challenge, authorization_details, redirect_uri,
  created_at, expires_at, consumed_at

tokens
  id, kind ('access' | 'refresh'), token_hash, jti,
  client_id, agent_id, customer_id, scope, authorization_details,
  parent_id,                              -- refresh rotation chain
  created_at, expires_at, revoked_at
```

Nothing in `customers` changes. **No `agent_user` table, no parallel accounts** —
the whole point. An agent acts *for* a customer that already existed.

### Seeded agents

| id | display name | owner |
|---|---|---|
| `agent_shopping_assistant` | Shopping Assistant | Northbound Labs |
| `agent_pantry_bot` | Pantry Bot | Example Automations |

`agent_shopping_assistant` matches the parent spec's example token.

---

## 6. Tokens

### 6.1 Shape

```json
{
  "iss": "https://<host>",
  "sub": "user_82731",
  "act": { "sub": "agent_shopping_assistant" },
  "client_id": "shopping-assistant",
  "aud": "https://<host>/api",
  "scope": "products.read cart.write checkout",
  "authorization_details": [
    { "type": "checkout", "maximum_amount": "10000", "currency": "USD" }
  ],
  "jti": "...", "iat": ..., "exp": ...
}
```

`act` is RFC 8693's actor claim, used here for its defined meaning: the party
acting on behalf of the subject. `sub` is the customer; `act.sub` is the agent.
**The agent never becomes the user** — a token with no `act` is a token the
customer obtained directly, and the two are distinguishable by construction.

`maximum_amount` as a minor-units string is an **extension**, labelled as such.

### 6.2 `ActorContext`

A's services take `customerId` first. B replaces that with:

```ts
type ActorContext = {
  customerId: number;
  actor: { agentId: string; clientId: string } | null;  // null = the customer directly
  scopes: string[];
  authorizationDetails: AuthorizationDetail[];
  source: 'browser' | 'api';
};
```

Server actions build one with `actor: null`. `/api/*` builds one from the token.
Both call the same service functions. This is the single boundary sub-project D's
policy engine and sub-project E's audit log will hook into.

`ActorContext` carries scopes but **does not enforce them** — enforcement lives
at the API edge in B and in the policy engine in D. A service that silently
ignored a missing scope would be worse than one that never saw it.

### 6.3 The bearer guard

One function wraps every `/api/*` handler:

```ts
withBearer(scopes: string[], handler: (ctx: ActorContext, req: Request) => Promise<Response>)
```

It extracts `Authorization: Bearer`, verifies signature, `iss`, `aud`, `exp`,
and revocation, checks the required scopes, builds the `ActorContext`, and calls
the handler. On any failure it returns the `WWW-Authenticate` challenge from
[§3.2](#32-the-challenge).

**It never reads cookies.** The API route handlers have no access to the session
helpers at all — enforced by a test, not by discipline.

---

## 7. Endpoints

```
/.well-known/oauth-protected-resource   RFC 9728
/.well-known/oauth-authorization-server RFC 8414
/.well-known/jwks.json

/oauth/register      RFC 7591 — open registration, demo-only warning in the response
/oauth/authorize     code + PKCE (S256 only); renders the consent screen
/oauth/token         authorization_code, refresh_token
/oauth/revoke        RFC 7009
/oauth/introspect    RFC 7662

/api/products  /api/products/[slug]
/api/cart      (GET, POST, DELETE)
/api/orders    /api/orders/[orderNumber]
/api/profile
/api/addresses
/api/openapi.json
```

Scope required per route follows the parent spec's list exactly.
`/api/payment-methods` is **not implemented** — sub-project D denies agents that
operation outright, and exposing an endpoint only to always refuse it would be
misleading.

---

## 8. The consent screen

The most screenshotted page in this project. It must show, without scrolling:

- The **agent's name and logo**, and its owner
- **Which customer** it will act for, by name and email
- The **exact scopes**, in plain language — not raw scope strings
- Any **RAR constraint** in plain language: *"can spend up to $100 per checkout"*
- **Approve** and **Deny** as a real pair — this is what A's `ghost` button
  variant was defined for

It carries the storefront's brand. A consent screen that looks like a developer
tool teaches the wrong lesson about where this boundary lives.

If the customer is not signed in, `/oauth/authorize` redirects to `/login` with
a return path, and comes back. Sub-project C replaces that with the per-user
authentication experience.

---

## 9. Security boundaries added here

1. **The API cannot see cookies.** `/api/*` handlers import `withBearer` and
   never `session-cookie`. A test asserts a cookie-only request gets `401`.
2. **PKCE is mandatory and `S256` only.** A missing `code_challenge` or
   `plain` method is rejected at `/oauth/authorize`, not at token exchange, so
   the client fails fast.
3. **Audience is validated.** A token minted for a different `aud` is rejected
   even though its signature is good.
4. **Authorization codes are single-use**, short-lived, hashed at rest, and
   bound to the client and redirect URI that requested them.
5. **Refresh reuse revokes the chain.**
6. **Registration is open, and says so.** RFC 7591 open registration is correct
   for a demo and wrong for production; the response body and the README both
   say it plainly rather than leaving it implied.

---

## 10. Required tests

Beyond ordinary coverage, the parent spec names these:

| Test | Asserts |
|---|---|
| Bearer-only | A request to `/api/orders` with a valid `nb_session` cookie and no bearer token gets `401` with a `WWW-Authenticate` challenge |
| Bearer-only, structural | No file under `app/api/` imports `lib/auth/session-cookie` |
| PKCE required | `/oauth/authorize` without `code_challenge` is rejected |
| PKCE S256 only | `code_challenge_method=plain` is rejected, and `plain` is absent from metadata |
| Audience | A token whose `aud` is not this resource is rejected by `withBearer` |
| Code single-use | Exchanging the same authorization code twice fails the second time |
| Refresh rotation | The old refresh token stops working; reuse revokes the chain |
| `act` claim | Every agent-obtained token carries `sub` **and** `act.sub`; a direct customer session produces no token at all |
| Discovery chain | 401 → PRM → AS metadata → register → authorize → token → retry succeeds, driven only by what each response advertises |

---

## 11. What is simplified

- Open dynamic registration with no software statement.
- No client authentication beyond `client_secret_basic` and `none`.
- Consent is not remembered between authorizations — every request asks again.
  Real retailers remember; a demo that remembers is a demo where you cannot show
  the consent screen twice.
- No `resource` indicator enforcement beyond a single audience.
- Keys are not rotated.

---

## 12. Open questions

None. Deviations from the parent spec are recorded in §2 and labelled in code.
