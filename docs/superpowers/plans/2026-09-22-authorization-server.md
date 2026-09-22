# Authorization Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a standards-based OAuth boundary to Northbound so a third-party agent can discover, register, obtain a token naming both itself and the customer, and call a bearer-only API — without ever receiving a browser session.

**Architecture:** One `AuthorizationServer` interface with a local implementation, mounted at `/oauth/*`. Access tokens are RS256 JWTs carrying `sub` (customer) and `act.sub` (agent). `/api/*` routes are wrapped by a single `withBearer` guard that builds an `ActorContext` and calls the same `lib/services/*` functions the storefront calls.

**Tech Stack:** Next.js 16 App Router, `jose` for JWS/JWKS, Drizzle over libsql, Zod, Vitest. Everything else inherited from sub-project A.

**Spec:** [docs/superpowers/specs/2026-09-22-authorization-server-design.md](../specs/2026-09-22-authorization-server-design.md)

**A note on this plan's density.** Sub-project A's plan was written for a fresh implementer with no context. This one is executed inline by the author of the spec, against conventions the repository now establishes and enforces by test. It therefore gives exact signatures, exact test cases, and code for everything non-obvious — JWT handling, PKCE, the bearer guard, refresh rotation — and prose for mechanics the existing code already demonstrates. Where it says "follow the pattern in X", X is a real file with that pattern in it.

## Global Constraints

- Everything in sub-project A's Global Constraints still holds, **except** that services now take `ActorContext` instead of `customerId`.
- `test/boundaries.test.ts` must keep passing. Its no-agent-vocabulary assertion is **scoped to A's surfaces** and must be narrowed deliberately in Task 5, not deleted.
- **`app/api/**` must never import `lib/auth/session-cookie`.** A test asserts this.
- PKCE is mandatory; `S256` only; `plain` never advertised and always rejected.
- Access tokens live **15 minutes**. Refresh tokens rotate; reuse revokes the chain.
- `maximum_amount` is a **string in minor units** and is labelled an extension wherever it appears.
- No secrets in the repo. Signing keys are generated into `data/keys.json`, which is gitignored.
- Issuer and all advertised URLs derive from the request `Host`, overridable by `NORTHBOUND_ISSUER`.

## Review Focus

Five failure modes the spec implies but whose tests are easy to write too weakly.

1. **A token that is valid but for the wrong audience or issuer is accepted.** Signature validity is not authorization; `aud` and `iss` must be checked explicitly, and a token minted by this server for a different resource must be rejected. → Task 8.
2. **An authorization code is replayed, or redeemed by a different client.** Codes must be single-use, bound to `client_id` and `redirect_uri`, and rejected after expiry. → Task 7.
3. **PKCE is advertised but not enforced.** A token exchange that omits `code_verifier`, or sends one that does not hash to the stored challenge, must fail. Advertising `S256` while accepting anything is worse than not advertising it. → Task 7.
4. **A revoked or expired token still works because the fast path trusts the JWT.** Verification must consult the revocation record, not only the signature. → Task 8.
5. **An open redirect via `redirect_uri`.** The value must be matched exactly against the registered set, not by prefix or hostname, at both `/oauth/authorize` and token exchange. → Task 6.

---

## File Structure

```
lib/oauth/
  issuer.ts            resolveIssuer(request) → base URL
  keys.ts              load-or-generate RS256 keypair; exportJWKS()
  jwt.ts               signAccessToken / verifyAccessToken (jose)
  pkce.ts              verifyCodeChallenge
  types.ts             ActorContext, AccessTokenClaims, AuthorizationDetail, scopes
  server.ts            AuthorizationServer interface + getAuthorizationServer()
  local/
    LocalAuthorizationServer.ts
    clients.ts         registration + lookup
    authorization.ts   request → consent → code
    tokens.ts          issue, refresh rotation, introspect, revoke
  descope/
    DescopeAuthorizationServer.ts   stub with TODOs

app/.well-known/
  oauth-protected-resource/route.ts
  oauth-authorization-server/route.ts
  jwks.json/route.ts

app/oauth/
  register/route.ts
  authorize/page.tsx  authorize/actions.ts
  token/route.ts
  revoke/route.ts
  introspect/route.ts

app/api/
  _lib/withBearer.ts   the ONLY auth path for /api
  products/route.ts    products/[slug]/route.ts
  cart/route.ts
  orders/route.ts      orders/[orderNumber]/route.ts
  profile/route.ts
  addresses/route.ts
  openapi.json/route.ts

components/brand/ConsentScreen.tsx
db/schema/oauth.ts
db/seed/agents.ts
```

---

## Task 1: Issuer, keys, and JWT

**Files:** `lib/oauth/{issuer,keys,jwt,types}.ts` · Test: `test/oauth-jwt.test.ts`

**Interfaces produced:**
- `resolveIssuer(req: Request): string`
- `getSigningKey(): Promise<{ privateKey; publicKey; kid }>` · `exportJwks(): Promise<JsonWebKeySet>`
- `signAccessToken(claims: AccessTokenInput, issuer: string): Promise<{ token; jti; expiresAt }>`
- `verifyAccessTokenSignature(token, issuer, audience): Promise<AccessTokenClaims>`
- `ActorContext`, `AccessTokenClaims`, `AuthorizationDetail`, `SCOPES`

- [ ] **Step 1: `pnpm add jose`**

- [ ] **Step 2: Write the failing test** — `test/oauth-jwt.test.ts`

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nb-keys-'));
  process.env.NORTHBOUND_KEY_FILE = join(dir, 'keys.json');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const ISSUER = 'https://shop.example';
const AUDIENCE = 'https://shop.example/api';

const claims = {
  customerId: 82731,
  agentId: 'agent_shopping_assistant',
  clientId: 'shopping-assistant',
  scope: 'products.read cart.write checkout',
  authorizationDetails: [
    { type: 'checkout' as const, maximum_amount: '10000', currency: 'USD' },
  ],
};

describe('access tokens', () => {
  it('carries both identities: sub is the customer, act.sub is the agent', async () => {
    const { signAccessToken, verifyAccessTokenSignature } = await import('@/lib/oauth/jwt');
    const { token } = await signAccessToken(claims, ISSUER);
    const verified = await verifyAccessTokenSignature(token, ISSUER, AUDIENCE);
    expect(verified.sub).toBe('user_82731');
    expect(verified.act).toEqual({ sub: 'agent_shopping_assistant' });
    expect(verified.client_id).toBe('shopping-assistant');
    expect(verified.aud).toBe(AUDIENCE);
  });

  it('expires in 15 minutes', async () => {
    const { signAccessToken, verifyAccessTokenSignature } = await import('@/lib/oauth/jwt');
    const { token } = await signAccessToken(claims, ISSUER);
    const v = await verifyAccessTokenSignature(token, ISSUER, AUDIENCE);
    expect(v.exp - v.iat).toBe(900);
  });

  // REVIEW FOCUS 1: a good signature is not authorization.
  it('rejects a token minted for a different audience', async () => {
    const { signAccessToken, verifyAccessTokenSignature } = await import('@/lib/oauth/jwt');
    const { token } = await signAccessToken(claims, ISSUER);
    await expect(verifyAccessTokenSignature(token, ISSUER, 'https://elsewhere/api'))
      .rejects.toThrow();
  });

  it('rejects a token from a different issuer', async () => {
    const { signAccessToken, verifyAccessTokenSignature } = await import('@/lib/oauth/jwt');
    const { token } = await signAccessToken(claims, 'https://evil.example');
    await expect(verifyAccessTokenSignature(token, ISSUER, AUDIENCE)).rejects.toThrow();
  });

  it('rejects a tampered payload', async () => {
    const { signAccessToken, verifyAccessTokenSignature } = await import('@/lib/oauth/jwt');
    const { token } = await signAccessToken(claims, ISSUER);
    const [h, p, s] = token.split('.');
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    payload.sub = 'user_19382';
    const forged = `${h}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${s}`;
    await expect(verifyAccessTokenSignature(forged, ISSUER, AUDIENCE)).rejects.toThrow();
  });

  it('gives every token a distinct jti', async () => {
    const { signAccessToken } = await import('@/lib/oauth/jwt');
    const a = await signAccessToken(claims, ISSUER);
    const b = await signAccessToken(claims, ISSUER);
    expect(a.jti).not.toBe(b.jti);
  });

  it('omits act entirely when there is no agent', async () => {
    const { signAccessToken, verifyAccessTokenSignature } = await import('@/lib/oauth/jwt');
    const { token } = await signAccessToken({ ...claims, agentId: null }, ISSUER);
    const v = await verifyAccessTokenSignature(token, ISSUER, AUDIENCE);
    expect(v.act).toBeUndefined();
  });
});

describe('signing keys', () => {
  it('generates once and reuses thereafter', async () => {
    const { getSigningKey } = await import('@/lib/oauth/keys');
    const first = await getSigningKey();
    const second = await getSigningKey();
    expect(first.kid).toBe(second.kid);
  });

  it('publishes a public JWKS with no private material', async () => {
    const { exportJwks } = await import('@/lib/oauth/keys');
    const jwks = await exportJwks();
    expect(jwks.keys[0].kty).toBe('RSA');
    expect(jwks.keys[0].alg).toBe('RS256');
    for (const secret of ['d', 'p', 'q', 'dp', 'dq', 'qi']) {
      expect(jwks.keys[0], secret).not.toHaveProperty(secret);
    }
  });
});

describe('resolveIssuer', () => {
  it('derives the issuer from the request host so ngrok works unconfigured', async () => {
    const { resolveIssuer } = await import('@/lib/oauth/issuer');
    expect(resolveIssuer(new Request('https://abc.ngrok.io/api/orders')))
      .toBe('https://abc.ngrok.io');
  });

  it('honours x-forwarded-proto and x-forwarded-host', async () => {
    const { resolveIssuer } = await import('@/lib/oauth/issuer');
    const req = new Request('http://internal/api', {
      headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'shop.example' },
    });
    expect(resolveIssuer(req)).toBe('https://shop.example');
  });

  it('lets NORTHBOUND_ISSUER override everything', async () => {
    process.env.NORTHBOUND_ISSUER = 'https://pinned.example';
    const { resolveIssuer } = await import('@/lib/oauth/issuer');
    expect(resolveIssuer(new Request('https://other/api'))).toBe('https://pinned.example');
    delete process.env.NORTHBOUND_ISSUER;
  });
});
```

- [ ] **Step 3: Run it. Expected: FAIL — modules do not exist.**

- [ ] **Step 4: Implement.**

`types.ts` — `SCOPES` as a const tuple matching the parent spec exactly, `AuthorizationDetail` with `maximum_amount` typed `string` and an extension comment, `ActorContext` exactly as spec §6.2, `AccessTokenClaims`.

`issuer.ts` — `NORTHBOUND_ISSUER` wins; else `x-forwarded-proto`/`x-forwarded-host`; else the request URL's origin. Strip any trailing slash.

`keys.ts` — read `process.env.NORTHBOUND_KEY_FILE ?? 'data/keys.json'`; if absent, `generateKeyPair('RS256', { extractable: true })`, export both as JWK, write with mode `0o600`, and log once that a key was generated. Cache in a module-level promise so concurrent calls generate once. `exportJwks` returns only public members plus `kid`, `use: 'sig'`, `alg: 'RS256'`.

`jwt.ts` — `new SignJWT({...}).setProtectedHeader({ alg: 'RS256', kid }).setIssuer().setAudience(`${issuer}/api`).setSubject(`user_${customerId}`).setJti(randomUUID()).setIssuedAt().setExpirationTime('15m')`. `act` is set only when `agentId` is non-null. Verify with `jwtVerify(token, publicKey, { issuer, audience })`.

- [ ] **Step 5: Run. Expected: PASS (12).** Then `pnpm test` — whole suite green.

- [ ] **Step 6: Commit** `feat(oauth): add issuer resolution, RS256 signing keys, and access tokens`

---

## Task 2: OAuth schema and seeded agents

**Files:** `db/schema/oauth.ts`, `db/seed/agents.ts`, migration · Test: `test/oauth-schema.test.ts`

**Produces:** `agents`, `oauthClients`, `authorizationRequests`, `authorizationCodes`, `tokens` tables exactly as spec §5; `seedAgents(db)`; `AGENT_IDS`.

- [ ] **Step 1: Write the failing test.** Assert: all five tables export from `@/db/schema`; `tokens.tokenHash` is unique; `authorizationCodes.codeHash` is unique; seeding creates exactly two agents including `agent_shopping_assistant`; `seedAll` remains idempotent and now also clears the OAuth tables in FK-safe order; **no column anywhere in the new schema is named to hold a raw token** (`grep` for `token text` without `_hash`).

- [ ] **Step 2: Run. Expected: FAIL.**

- [ ] **Step 3: Implement** following `db/schema/commerce.ts` for style. Comment on `tokens.tokenHash`: *tokens are stored hashed, so a database read cannot be replayed as a credential.* Wire `seedAgents` into `db/seed/index.ts` after `seedCustomers`, and add the five new tables to the truncation list at the top of `seedAll`.

- [ ] **Step 4: `pnpm db:generate && pnpm db:migrate`, run tests. Expected: PASS.**

- [ ] **Step 5: Commit** `feat(oauth): add client, code and token schema with seeded agents`

---

## Task 3: The AuthorizationServer interface and client registration

**Files:** `lib/oauth/server.ts`, `lib/oauth/local/{LocalAuthorizationServer,clients}.ts`, `lib/oauth/descope/DescopeAuthorizationServer.ts` · Test: `test/oauth-registration.test.ts`

**Produces:** the interface from spec §4; `getAuthorizationServer()` returning the Descope stub when `DESCOPE_PROJECT_ID` is set and the local one otherwise.

- [ ] **Step 1: Write the failing test.**

Cases: registration returns `client_id`, `client_id_issued_at`, and the registered metadata echoed back; a confidential client gets a `client_secret` returned **once** and stored only hashed; a public client (`token_endpoint_auth_method: 'none'`) gets no secret; registration **rejects a request with no `redirect_uris`**; rejects a non-absolute or non-https redirect URI except `http://localhost` and `http://127.0.0.1`; the response body carries a `demo_notice` field warning that registration is open; `getAuthorizationServer()` returns the Descope stub when `DESCOPE_PROJECT_ID` is set, and every stub method rejects with a message naming what a real implementation would call.

- [ ] **Step 2: Run. Expected: FAIL.**

- [ ] **Step 3: Implement.** Registration validates with Zod, generates `client_id` as `nbc_<24 hex>`, hashes any secret with the existing `hashPassword` from `lib/auth/password.ts` (already scrypt, already tested — do not add a second hashing scheme), and links `agent_id` when the request carries a recognised one, otherwise creates an `agents` row from `client_name` so every client has an identifiable actor.

Localhost-over-http is allowed because CLI agents redirect there; everything else must be https. This is the anti-open-redirect rule's first half — the second half is exact matching at authorize time (Task 6).

- [ ] **Step 4: Run. Expected: PASS.** Whole suite green.

- [ ] **Step 5: Commit** `feat(oauth): add AuthorizationServer interface, local implementation, and RFC 7591 registration`

---

## Task 4: Discovery endpoints

**Files:** `app/.well-known/{oauth-protected-resource,oauth-authorization-server,jwks.json}/route.ts`, `app/oauth/register/route.ts` · Test: `test/oauth-discovery.test.ts`

- [ ] **Step 1: Write the failing test.**

Cases: PRM returns exactly the four required fields with `resource` = `<issuer>/api` and `bearer_methods_supported: ['header']`; AS metadata advertises `code_challenge_methods_supported: ['S256']` and **does not contain the string `plain`**; `grant_types_supported` is exactly `['authorization_code','refresh_token']` at this stage; every advertised URL starts with the issuer derived from the request host; JWKS serves the public key with no private members; all three respond to a request with a different `Host` by echoing that host, so ngrok needs no configuration; `POST /oauth/register` round-trips through the route and returns `201`.

- [ ] **Step 2: Run. Expected: FAIL.**

- [ ] **Step 3: Implement.** Each route resolves the issuer from the request and delegates to `getAuthorizationServer().metadata(issuer)`. All three set `Cache-Control: no-store` — advertised URLs vary by host, and a cached PRM served to the wrong host would send an agent to the wrong authorization server.

- [ ] **Step 4: Run. Expected: PASS.** Commit `feat(oauth): serve PRM, AS metadata, JWKS and the registration endpoint`

---

## Task 5: ActorContext

**Files:** every file in `lib/services/`, every server action, `test/boundaries.test.ts` · Tests: all existing service tests updated

This is the agent-support commit. Its diff is the teaching artifact the spec talks about, so keep it mechanical and readable: signature change and nothing else.

- [ ] **Step 1: Add `browserContext(customerId): ActorContext`** to `lib/oauth/types.ts` — `{ customerId, actor: null, scopes: [], authorizationDetails: [], source: 'browser' }`.

- [ ] **Step 2: Change every service signature** from `(customerId: number, ...)` to `(ctx: ActorContext, ...)`, and replace internal uses of `customerId` with `ctx.customerId`. The compiler finds every call site; work through `pnpm build` until clean. **No behaviour changes in this task** — no scope checks, no policy. A service that silently enforced a scope would be worse than one that never saw it.

- [ ] **Step 3: Update every server action** to pass `browserContext(customer.id)`.

- [ ] **Step 4: Update every existing service test** to pass `browserContext(ids.alice)` instead of `ids.alice`.

- [ ] **Step 5: Narrow `test/boundaries.test.ts` deliberately.** Its no-agent-vocabulary assertion must now exclude `lib/oauth/`, `app/oauth/`, `app/api/`, and `app/.well-known/`, and the exclusion list must be written as an explicit allowlist with a comment saying why each entry is there. Add an assertion that `app/` outside those four directories still contains no OAuth vocabulary — the storefront pages must stay clean.

- [ ] **Step 6: Run the whole suite. Expected: PASS, with no test's *assertions* changed** — only the way each obtains a context. Commit `refactor: thread ActorContext through the service layer` with a body explaining that this is where agent support enters.

---

## Task 6: Authorize endpoint and consent screen

**Files:** `app/oauth/authorize/{page.tsx,actions.ts}`, `components/brand/ConsentScreen.tsx`, `lib/oauth/local/authorization.ts` · Test: `test/oauth-authorize.test.ts`

**Owns Review Focus 5.**

- [ ] **Step 1: Write the failing test.**

Cases: a request missing `code_challenge` is rejected with `invalid_request`; `code_challenge_method=plain` is rejected; an unknown `client_id` is rejected **without redirecting** (there is no trustworthy redirect target yet); a `redirect_uri` that is not *character-for-character* one of the registered URIs is rejected without redirecting — including `https://registered.example.evil.com` and `https://registered.example/cb/../other`; an unregistered scope is rejected; `authorization_details` with a `maximum_amount` that is not a minor-units string is rejected; approving creates a single-use code bound to the client, redirect URI and challenge; denying redirects with `error=access_denied` and creates no code; `state` is echoed back unchanged.

- [ ] **Step 2: Run. Expected: FAIL.**

- [ ] **Step 3: Implement `createAuthorizationRequest`.** Validate in this order — client, then redirect URI (exact match against the registered array), then everything else. Only after the redirect URI is known-good may an error be delivered by redirecting; before that, render an error page. That ordering *is* the open-redirect defence, and it gets a comment saying so.

- [ ] **Step 4: Build the consent screen** per spec §8. Server component reads the pending request; `ConsentScreen` renders agent name, logo, owner, the customer's name and email, scopes in plain language via a `SCOPE_LABELS` map, and RAR constraints rendered as *"can spend up to $100 per checkout"* by formatting the minor-units string. Approve is `Button variant="primary"`; Deny is `Button variant="ghost"` — the variant sub-project A defined for exactly this pair.

If no session, redirect to `/login?next=<encoded authorize URL>`; add `next` support to `loginAction` with a **same-origin, path-only** allowlist.

- [ ] **Step 5: Run. Expected: PASS.** Screenshot the consent screen in the browser and confirm it is presentable.

- [ ] **Step 6: Commit** `feat(oauth): add authorization endpoint with PKCE and the consent screen`

---

## Task 7: Token endpoint

**Files:** `app/oauth/token/route.ts`, `lib/oauth/local/tokens.ts` · Test: `test/oauth-token.test.ts`

**Owns Review Focus 2 and 3.**

- [ ] **Step 1: Write the failing test.**

Cases: code exchange with the correct `code_verifier` returns `access_token`, `refresh_token`, `token_type: 'Bearer'`, `expires_in: 900`, and `scope`; **the same code twice fails the second time** and revokes any token already issued from it; a code redeemed by a different `client_id` fails; a code redeemed with a different `redirect_uri` fails; a **missing** `code_verifier` fails; a `code_verifier` that does not hash to the challenge fails; an expired code fails; refresh returns a new pair and the **old refresh token stops working**; **reusing a rotated refresh token revokes the whole chain** so the newest token also stops working; the issued access token carries `act.sub`; errors use OAuth error codes (`invalid_grant`, `invalid_client`, `invalid_request`) and never leak whether a code merely expired or never existed.

- [ ] **Step 2: Run. Expected: FAIL.**

- [ ] **Step 3: Implement.** PKCE verification:

```ts
export function verifyCodeChallenge(verifier: string, challenge: string): boolean {
  // S256 only. `plain` is neither advertised nor accepted: a challenge that is
  // its own verifier proves nothing about the client that started the flow.
  const hash = createHash('sha256').update(verifier, 'ascii').digest();
  return timingSafeEqualStrings(hash.toString('base64url'), challenge);
}
```

Rotation: on refresh, mark the presented token `revokedAt` and insert the new one with `parentId` pointing at it. On presentation of an already-revoked refresh token, walk `parentId` forward and revoke every descendant — the standard response to a suspected theft, commented as such.

Store `tokenHash` (sha256), never the token.

- [ ] **Step 4: Run. Expected: PASS.** Commit `feat(oauth): add token endpoint with PKCE verification and refresh rotation`

---

## Task 8: The bearer guard and the API

**Files:** `app/api/_lib/withBearer.ts`, `app/api/**/route.ts` · Test: `test/api-bearer.test.ts`

**Owns Review Focus 1 and 4. This task carries the parent spec's headline requirement.**

- [ ] **Step 1: Write the failing test.**

| Case | Expectation |
|---|---|
| No `Authorization` header | `401` + `WWW-Authenticate` containing `resource_metadata=` |
| **A valid `nb_session` cookie and no bearer token** | **`401`** — the headline test |
| A valid session cookie *and* a valid bearer token | `200`, and the response reflects the **token's** customer, not the cookie's |
| Token with wrong `aud` | `401 invalid_token` |
| Token from another issuer | `401` |
| Expired token | `401` |
| **Revoked token whose signature is still valid** | `401` — the fast path must consult the revocation record |
| Token missing a required scope | `403 insufficient_scope`, with `scope=` in the challenge |
| Valid token | `200`, and `ctx.actor.agentId` is the agent |
| Structural | No file under `app/api/` imports `lib/auth/session-cookie` |
| Ownership | A token for Alice cannot read Bob's order — `404`, reusing the service's existing scoping |

- [ ] **Step 2: Run. Expected: FAIL.**

- [ ] **Step 3: Implement `withBearer`.** Resolve issuer → extract bearer → `verifyAccessTokenSignature` → look up the `tokens` row by `jti` and reject if `revokedAt` is set → check scopes → build `ActorContext` with `source: 'api'` → call the handler. Map `ServiceError` subclasses to status codes in one place: `NotFoundError` → 404, `OwnershipError` → 403, `OutOfStockError`/`ValidationError` → 400, `PriceChangedError` → 409, `ConcurrencyError` → 503 with `Retry-After`.

The file gets the heaviest comment in sub-project B: **this is the only way into `/api/*`, it never reads a cookie, and that is the point.**

- [ ] **Step 4: Implement the routes** from spec §7, each one `withBearer([...scopes], handler)` calling the same service functions the storefront calls. No `/api/payment-methods`.

- [ ] **Step 5: Run. Expected: PASS.** Commit `feat(api): add bearer-only API with a single guarded entry point`

---

## Task 9: Revocation and introspection

**Files:** `app/oauth/{revoke,introspect}/route.ts` · Test: `test/oauth-revoke-introspect.test.ts`

- [ ] **Step 1: Write the failing test.** Cases: revoking an access token makes a subsequent `/api` call fail; revoking a refresh token revokes its descendants; revoking an unknown token returns `200` per RFC 7009; introspection of a live token returns `active: true` with `sub`, `act`, `client_id`, `scope`, `exp`; introspection of a revoked or expired token returns **exactly** `{ "active": false }` and nothing else; introspection requires client authentication and returns `401` without it.

- [ ] **Step 2–4:** Run (FAIL) → implement → run (PASS) → commit `feat(oauth): add RFC 7009 revocation and RFC 7662 introspection`

---

## Task 10: OpenAPI, the Descope seam, and the discovery-chain test

**Files:** `app/api/openapi.json/route.ts`, `lib/oauth/descope/DescopeAuthorizationServer.ts`, `README.md` · Test: `test/discovery-chain.test.ts`

- [ ] **Step 1: Write the end-to-end discovery test** — the one that proves the parent spec's first success criterion. Drive it **only** by what each response advertises, never by a hardcoded path:

```
GET /api/orders                      → 401; read resource_metadata from WWW-Authenticate
GET <that URL>                       → PRM; read authorization_servers[0]
GET <that>/.well-known/oauth-authorization-server → metadata; read registration_endpoint
POST <registration_endpoint>         → client_id
  (authorize + consent approved directly through the AS interface, since a
   headless test cannot click; the HTTP authorize path is covered in Task 6)
POST <token_endpoint>                → access_token
GET /api/orders with the token       → 200, and the orders belong to the customer
```

Assert that no URL in the test is written as a literal except the first.

- [ ] **Step 2: Run. Expected: FAIL.** Implement whatever the chain needs.

- [ ] **Step 3: OpenAPI** — generate from one route table so the spec and the routes cannot drift; assert in a test that every path in the document resolves to a real route file.

- [ ] **Step 4: Finish the Descope stub** — every method throws with a TODO naming the Descope API it would call, and a comment that this seam exists so the local AS is not load-bearing for the architecture.

- [ ] **Step 5: Update the README** — an agent recipe section (curl walkthrough of the discovery chain, MCP Inspector and ngrok deferred to the sub-project that adds MCP), the new env vars, and a "what is simplified" addition covering open registration and unremembered consent.

- [ ] **Step 6: Full suite, cold-clone rehearsal, commit.**

---

## Self-review notes

**Spec coverage.** §3 discovery → Tasks 1, 4; §4 interface → Task 3; §5 schema → Task 2; §6 tokens → Tasks 1, 7, 8; §7 endpoints → Tasks 4, 6, 7, 8, 9; §8 consent → Task 6; §9 boundaries → Tasks 6, 7, 8; §10 required tests → Tasks 6, 7, 8, 10.

**Known soft spots.** Task 5 is a wide mechanical refactor; its risk is scope creep, so it is specified to change signatures and nothing else. Task 6's consent screen is specified by content rather than markup, deliberately — the brand system from A already fixes the visual language. Task 10's OpenAPI generation is the one place I expect to discover that generating from a route table is more work than writing it by hand; if so, write it by hand and add the drift test, which is the part that matters.
