/**
 * Every scope this resource understands.
 *
 * Colon separators, matching the blog post this demo accompanies. Readers diff
 * the post against the repository, and a mismatch there reads as carelessness
 * about the thing the post is teaching.
 */
export const SCOPES = [
  'products:read',
  'orders:read',
  'cart:read',
  'cart:write',
  'checkout',
  'profile:read',
  'addresses:write',
  'payment_methods:write',
] as const;

export type Scope = (typeof SCOPES)[number];

export function isScope(value: string): value is Scope {
  return (SCOPES as readonly string[]).includes(value);
}

/**
 * A Rich Authorization Request detail — RFC 9396.
 *
 * RFC 9396 defines `type` and leaves everything else to the API designer.
 * These fields are Northbound's:
 *
 *   max_amount : { value, currency } where value is a MAJOR-UNIT decimal
 *                string — "200.00" means two hundred dollars
 *   merchant   : which store the grant applies to
 *   period     : ISO 8601 duration the cap is measured over. "P7D" means
 *                $200 across seven days, NOT $200 per order.
 *
 * The string-in-an-object shape is the one the customer approves and the one
 * the backend reads back off the token, so it is the single description of
 * what the agent may spend.
 */
export type PurchaseAuthorizationDetail = {
  type: 'purchase';
  max_amount: { value: string; currency: string };
  merchant: string;
  period: string;
};

export type AuthorizationDetail = PurchaseAuthorizationDetail;

/** A plain positive decimal with at most two fractional digits. */
const MONEY_PATTERN = /^(0|[1-9]\d*)(\.\d{1,2})?$/;

/**
 * Converts a major-unit decimal string to integer cents.
 *
 * Every downstream comparison is in integer cents, so this is the one place a
 * rounding mistake could let an agent overspend. It parses the digits directly
 * rather than multiplying a float by 100, because `8.15 * 100` is 814.9999…
 * and `Math.round` papering over that is a habit worth not having here.
 *
 * Throws rather than returning a sentinel: this parses data that arrived with
 * an agent's request, and a silently-zero cap is indistinguishable from a
 * deliberate denial.
 */
export function parseMoneyValue(value: string): number {
  if (typeof value !== 'string' || !MONEY_PATTERN.test(value)) {
    throw new Error(
      `max_amount.value must be a decimal string like "200.00", got ${JSON.stringify(value)}`,
    );
  }

  const [whole, fraction = ''] = value.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));

  if (cents <= 0) {
    throw new Error('max_amount.value must be greater than zero; omit the grant to deny');
  }

  return cents;
}

/** The inverse, so a cap can be shown to a customer in the units they approved. */
export function formatMoneyValue(cents: number): string {
  return (cents / 100).toFixed(2);
}

const PERIOD_PATTERN = /^P(?:(\d+)W|(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?)$/;

const MS = { week: 604_800_000, day: 86_400_000, hour: 3_600_000, minute: 60_000, second: 1_000 };

/**
 * Parses the subset of ISO 8601 durations that make sense for a spending window.
 *
 * Weeks, days, hours, minutes and seconds only. Years and months are rejected
 * deliberately: their length depends on when you start counting, and a
 * spending cap whose window changes size depending on the month is a bug
 * waiting to be argued about.
 */
export function parsePeriod(period: string): number {
  if (typeof period !== 'string') throw new Error('period must be a string');

  const match = PERIOD_PATTERN.exec(period);
  if (!match) {
    throw new Error(
      `period must be an ISO 8601 duration of weeks, days, hours, minutes or `
      + `seconds, like "P7D", got ${JSON.stringify(period)}`,
    );
  }

  const [, weeks, days, hours, minutes, seconds] = match;
  const total =
    Number(weeks ?? 0) * MS.week
    + Number(days ?? 0) * MS.day
    + Number(hours ?? 0) * MS.hour
    + Number(minutes ?? 0) * MS.minute
    + Number(seconds ?? 0) * MS.second;

  if (total <= 0) throw new Error(`period must be greater than zero, got ${period}`);

  return total;
}

/** Validates an authorization_details entry that arrived from outside. */
export function isPurchaseDetail(value: unknown): value is PurchaseAuthorizationDetail {
  if (!value || typeof value !== 'object') return false;
  const detail = value as Record<string, unknown>;

  if (detail.type !== 'purchase') return false;
  if (typeof detail.merchant !== 'string' || detail.merchant.length === 0) return false;

  const amount = detail.max_amount as Record<string, unknown> | undefined;
  if (!amount || typeof amount !== 'object') return false;
  if (typeof amount.value !== 'string' || typeof amount.currency !== 'string') return false;

  try {
    parseMoneyValue(amount.value);
    parsePeriod(detail.period as string);
  } catch {
    return false;
  }

  return true;
}

/** Claims carried by an issued access token. */
export type AccessTokenClaims = {
  iss: string;
  sub: string;
  /**
   * RFC 8693's actor claim, used for its defined meaning: the party acting on
   * behalf of the subject. Absent when the customer obtained the token
   * directly. `sub` is always the customer — the agent NEVER becomes the user.
   */
  act?: { sub: string };
  client_id: string;
  aud: string;
  scope: string;
  authorization_details?: AuthorizationDetail[];
  jti: string;
  iat: number;
  exp: number;
};

/**
 * Who an operation is for, and who is performing it.
 *
 * This is the boundary sub-project A deliberately did not have. Every service
 * function takes one. The storefront builds one with `actor: null`; the API
 * builds one from a token. Both then call the same code, which is what makes
 * "the application decides what the agent may do" true in the implementation
 * rather than only in the diagram.
 *
 * It CARRIES scopes and limits but does not ENFORCE them. Enforcement happens
 * at the API edge and in the checkout guardrail. A service that silently
 * ignored a missing scope would be worse than one that never saw it.
 */
export type ActorContext = {
  customerId: number;
  actor: { agentId: string; clientId: string } | null;
  scopes: Scope[];
  authorizationDetails: AuthorizationDetail[];
  source: 'browser' | 'api';
};

/** The context a signed-in human gets. No actor, no scopes, no constraints. */
export function browserContext(customerId: number): ActorContext {
  return {
    customerId,
    actor: null,
    scopes: [],
    authorizationDetails: [],
    source: 'browser',
  };
}

export function isAgentContext(
  ctx: ActorContext,
): ctx is ActorContext & { actor: { agentId: string; clientId: string } } {
  return ctx.actor !== null;
}

/** The purchase grant on a context, if the customer approved one. */
export function purchaseGrant(ctx: ActorContext): PurchaseAuthorizationDetail | null {
  return ctx.authorizationDetails.find((d) => d.type === 'purchase') ?? null;
}
