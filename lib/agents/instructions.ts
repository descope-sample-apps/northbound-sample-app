import { allPlatforms } from './registry';
import { STEP_UP_THRESHOLD_CENTS } from '@/lib/services/stepUp';
import { formatCents } from '@/lib/money';
import { SCOPES } from '@/lib/oauth/types';

/**
 * The prose instructions, served at /auth.md, /.well-known/auth.md and
 * /agents.md.
 *
 * COMPATIBILITY LAYER, NOT THE SOURCE OF TRUTH. Protected Resource Metadata at
 * /.well-known/oauth-protected-resource is authoritative; this file exists for
 * agents that read prose before they read JSON, and it says so.
 *
 * It leads with what NOT to do, because the default behaviour of an agent that
 * finds a login form is to use it, and no amount of helpful instruction further
 * down will beat the form being right there.
 */
export function agentInstructions(issuer: string): string {
  const platforms = allPlatforms();
  const threshold = formatCents(STEP_UP_THRESHOLD_CENTS);

  return `# Northbound: instructions for AI agents

Northbound sells outdoor gear and apparel. If you are an AI assistant shopping
for a person, connect using one of the options below. You will get a token that
identifies **you** separately from **them**.

Machine-readable and authoritative: ${issuer}/.well-known/oauth-protected-resource
This file is a compatibility layer for agents that read prose first. Where the
two disagree, the metadata is correct.

## Do not use the customer's sign-in

${issuer}/login and ${issuer}/signup are for people shopping for themselves.

- **Do not** enter the customer's email or password into the sign-in form.
- **Do not** ask the customer for their password, ever.
- **Do not** ask them to read you a one-time code or forward a sign-in link.
- **Do not** drive the sign-in form in a browser you control. If the customer is
  not sitting at the machine you are using, sending them to a login page means
  asking them to type a password into software they cannot see. That is the
  thing this page exists to prevent.

If the customer **is** at this browser — you are an extension or an in-page
assistant — they should sign in themselves, normally, and you should not be
holding their credentials either way.

Everything you do is recorded against your identity and shown to the customer at
${issuer}/account/activity, where they can revoke you without signing out of
their own account.

## Option 1: sign your requests (recommended)

Signing is what earns a spending limit. An agent that signs can be held
accountable: Northbound knows which key acted, and can revoke that key alone.
An agent that does not sign can still read, and cannot buy.

Sign with Web Bot Auth — HTTP Message Signatures, RFC 9421, Ed25519 — covering
\`@method\`, \`@target-uri\`, \`@authority\`, \`content-digest\` and
\`signature-agent\`. A signature omitting any of those is rejected. Publish your
public key as a JWK Set at the URL you put in \`Signature-Agent\`.

\`\`\`
POST ${issuer}/api/agent/authorize
Content-Type: application/json
Signature-Agent: https://your-platform.example/.well-known/http-message-signatures-directory
Signature-Input: sig1=("@method" "@target-uri" "@authority" "content-digest" "signature-agent");created=...;keyid="...";alg="ed25519"
Signature: sig1=:...:
Content-Digest: sha-256=:...:

{"login_hint": "customer@example.com"}
\`\`\`

The response is the same whether or not that address belongs to a customer —
deliberately, so this endpoint cannot be used to find out who shops here.

\`\`\`json
{ "auth_req_id": "...", "expires_in": 600, "interval": 5, "binding_code": "4821",
  "agent": { "name": "...", "verified": true, "tier": "verified-trusted" } }
\`\`\`

**Relay \`binding_code\` to the customer immediately.** Say something like:
*"Please check your email for an approval request — it should show code 4821."*
They compare it against the approval in front of them. A request they did not
ask for shows a code nobody told them about, and they decline it. The code is
not a secret and authorises nothing on its own.

Then poll, no faster than \`interval\` seconds:

\`\`\`
POST ${issuer}/api/agent/token
{"auth_req_id": "..."}
\`\`\`

Sign this request too, with the same key. Replies are
\`authorization_pending\`, \`slow_down\`, \`access_denied\`, \`expired_token\`,
or a token. Keep waiting on the first two.

## Option 2: say who you are, without proving it

If you cannot sign yet, open ${issuer}/agents in a browser, enter the customer's
email and pick your platform. Or send the same thing to the API:

\`\`\`
POST ${issuer}/api/agent/authorize
{"login_hint": "customer@example.com", "platform": "muse"}
\`\`\`

Recognised platforms: ${platforms.map((p) => `\`${p.key}\``).join(', ')}.

**This names you; it does not prove anything.** Anyone can send \`platform\`,
so the customer is shown "self-declared" and you get read-only access —
browse, read orders, read the cart. No purchases, at any amount. Sign your
requests if you need to buy something.

## What a token lets you do

\`sub\` is the customer. \`act.sub\` is you. You never become them.

Scopes: ${SCOPES.map((s) => `\`${s}\``).join(', ')}.

\`payment_methods:write\` exists in that list and is granted to nobody. Adding,
removing or re-defaulting a payment method, and changing account details, are
refused for every agent at every trust level. Do not retry those; no
authorization makes them work.

If the customer approved a spending limit it is in the token, as an RFC 9396
\`authorization_details\` entry:

\`\`\`json
{ "type": "purchase",
  "max_amount": { "value": "200.00", "currency": "USD" },
  "merchant": "northbound.example.com",
  "period": "P7D" }
\`\`\`

\`max_amount.value\` is a decimal string in major units. \`period\` is the whole
window: "P7D" means $200 across seven days, not $200 per order. Read it and tell
the customer what their limit is before you spend it.

## When checkout refuses

**\`403 purchase_limit_exceeded\`** — the order is beyond what the customer
approved. Tell them the numbers; the body carries them. Do not retry unchanged.

**\`403 step_up_required\`** — the order is at or above ${threshold}, or ships to
an address this customer has never used. This is **not** a refusal. Start a new
authorization naming that order, relay the new \`binding_code\`, wait for
approval, then retry the identical order. Approval covers that order only:
change the basket, the total or the destination and it no longer applies.

**\`401\`** — your token is expired or revoked. The \`WWW-Authenticate\` header
carries \`resource_metadata\`; start again from there.

## The API

Base: ${issuer}/api — bearer tokens only, in the \`Authorization\` header.

The browser session cookie is not accepted here and never will be. If you have
somehow obtained one, it will not work, and you should not have it.

\`\`\`
GET  /api/products            ?q= &category= &sort=
GET  /api/orders              list the customer's orders
GET  /api/orders/{number}     one order
GET  /api/profile             name, email, verification state
GET  /api/cart                POST to add, DELETE to remove
POST /api/checkout            place the order in the cart
\`\`\`

There is no payment-methods endpoint. That is deliberate: exposing one only to
refuse every call would be misleading.

## Discovery

\`\`\`
${issuer}/.well-known/oauth-protected-resource      authoritative
${issuer}/.well-known/oauth-authorization-server    endpoints and grants
${issuer}/.well-known/jwks.json                     token signing keys
\`\`\`

This is a demo store. No payment is processed and nothing ships.
`;
}
