import type { PurchaseAuthorizationDetail, Scope } from '@/lib/oauth/types';
import type { VerificationResult } from './verify';

/**
 * The three tiers from the blog's policy table.
 *
 * The distinction that matters is between the second and third. A valid
 * signature from a platform nobody has heard of is still a *real* signature —
 * Northbound knows exactly which key signed it and can revoke or rate-limit
 * that key specifically. It just has not earned the trusted cap. Collapsing
 * "unknown platform" into "unverified" would throw away the accountability
 * that signing provides.
 */
export type AgentTier =
  | 'verified-trusted'
  | 'verified-unknown'
  /**
   * The agent clicked a button on /agents saying which platform it is.
   *
   * That is a CLAIM, not proof — anyone can click it. It earns a name on the
   * consent screen and in the audit log, and nothing else. If a button could
   * reach a purchasing tier, signing would buy nothing and the tier table
   * above it would be decorative.
   */
  | 'declared'
  | 'unverified';

export const MERCHANT = 'northbound.example.com';

/**
 * Purchase caps, exactly as the blog's table states them.
 *
 * `null` for unverified means NO purchase grant at all, rather than a grant of
 * zero. The two are different things: a zero cap reads as an approved
 * permission worth nothing, and the honest encoding of "may not buy" is the
 * absence of permission.
 */
const CAPS: Record<AgentTier, PurchaseAuthorizationDetail | null> = {
  'verified-trusted': {
    type: 'purchase',
    max_amount: { value: '200.00', currency: 'USD' },
    merchant: MERCHANT,
    period: 'P7D',
  },
  'verified-unknown': {
    type: 'purchase',
    max_amount: { value: '50.00', currency: 'USD' },
    merchant: MERCHANT,
    period: 'P7D',
  },
  // A claim is not a credential. Named, but may not buy.
  declared: null,
  unverified: null,
};

const READ_ONLY_SCOPES: Scope[] = ['products:read', 'orders:read', 'cart:read', 'profile:read'];

const PURCHASING_SCOPES: Scope[] = [
  ...READ_ONLY_SCOPES, 'cart:write', 'checkout', 'addresses:write',
];

/**
 * Turns a verification result into a trust tier.
 *
 * `verified` is checked FIRST and the allowlist second. An unverified result
 * can never reach the trusted tier even when it names a directory on the
 * allowlist — claiming to be a trusted platform is free, and proving it is
 * what the signature is for.
 */
export function classifyAgent(
  result: VerificationResult,
  trustedHosts: string[],
): AgentTier {
  if (!result.verified) return 'unverified';
  if (!result.directoryUrl) return 'unverified';

  let host: string;
  try {
    host = new URL(result.directoryUrl).host;
  } catch {
    return 'unverified';
  }

  return trustedHosts.includes(host) ? 'verified-trusted' : 'verified-unknown';
}

export function capForTier(tier: AgentTier): PurchaseAuthorizationDetail | null {
  return CAPS[tier];
}

/** Note that `payment_methods:write` is on no tier's list, at any trust level. */
export function scopesForTier(tier: AgentTier): Scope[] {
  const canPurchase = tier === 'verified-trusted' || tier === 'verified-unknown';
  return canPurchase ? [...PURCHASING_SCOPES] : [...READ_ONLY_SCOPES];
}

/** A sentence the customer will read on the approval screen. */
export function bindingMessageFor(
  tier: AgentTier,
  agentName: string,
  merchant = MERCHANT,
): string {
  const cap = capForTier(tier);
  if (!cap) {
    return `${agentName} wants to read your orders and cart at ${merchant}. It will not be able to buy anything.`;
  }

  const days = Number(/^P(\d+)D$/.exec(cap.period)?.[1] ?? 7);
  return `${agentName} wants to place orders up to $${cap.max_amount.value} at `
    + `${merchant} over the next ${days} days.`;
}
