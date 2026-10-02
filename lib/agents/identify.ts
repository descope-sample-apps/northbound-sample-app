import { verifyAgentSignature } from '@/lib/webbotauth/verify';
import type { AgentTier } from '@/lib/webbotauth/tiers';
import {
  descopeClientIdFor, platformByDirectoryHost, platformByKey,
  type AgentPlatform,
} from './registry';

export type AgentIdentity = {
  tier: AgentTier;
  /** True only when a signature verified. Never set by a button click. */
  verified: boolean;
  /** Registered platform, when one matched. */
  platformKey: string | null;
  displayName: string;
  owner: string | null;
  logoPath: string | null;
  /** The Descope client that carries this agent's identity into a policy. */
  descopeClientId: string | null;
  /** True when a client has to be created before CIBA can be started. */
  needsDescopeClient: boolean;
  directoryUrl?: string;
  keyId?: string;
  /** Why verification failed, for the audit log. Never shown to the agent. */
  reason?: string;
};

/**
 * Works out who is asking, on the backend, before any CIBA request goes out.
 *
 * Both entry points use this: an agent calling POST /api/agent/authorize and a
 * person clicking a button on /agents. Nothing identifies an agent in the
 * browser, because anything the browser asserts is just another claim.
 *
 * ORDER MATTERS. The signature is checked first and wins outright. A declared
 * platform is only consulted when there is no signature at all — never to
 * rescue one that failed, and never to upgrade one that succeeded. Those two
 * rules are what stop a button click laundering a forged signature into a
 * trusted identity.
 */
export async function identifyAgent(
  request: Request,
  options: { declaredPlatform?: string; fetchImpl?: typeof fetch } = {},
): Promise<AgentIdentity> {
  const hasSignature = request.headers.has('signature');

  if (hasSignature) {
    const result = await verifyAgentSignature(request, { fetchImpl: options.fetchImpl });

    if (result.verified && result.directoryUrl) {
      const host = new URL(result.directoryUrl).host;
      const platform = platformByDirectoryHost(host);

      // `trusted` applies only on the proven path, which is this one.
      const tier: AgentTier = platform?.trusted ? 'verified-trusted' : 'verified-unknown';
      const descopeClientId = descopeClientIdFor(platform);

      return {
        tier,
        verified: true,
        platformKey: platform?.key ?? null,
        // An unregistered platform is still named — by its directory — so the
        // audit log can tell one stranger from the next.
        displayName: platform?.displayName ?? `Unregistered agent at ${host}`,
        owner: platform?.owner ?? null,
        logoPath: platform?.logoPath ?? null,
        descopeClientId,
        needsDescopeClient: descopeClientId === null,
        directoryUrl: result.directoryUrl,
        keyId: result.keyId,
      };
    }

    // A signature that was presented and did not verify. The declared platform
    // below is deliberately NOT consulted — that would let an attacker send a
    // forged signature and a button claim and be treated as the claim.
    return unidentified(result.reason ?? 'signature did not verify', result.directoryUrl);
  }

  if (options.declaredPlatform) {
    const platform = platformByKey(options.declaredPlatform);
    if (platform) return declared(platform);
  }

  return unidentified(options.declaredPlatform
    ? 'declared an unregistered platform'
    : 'no signature and no declared platform');
}

function declared(platform: AgentPlatform): AgentIdentity {
  const descopeClientId = descopeClientIdFor(platform);

  return {
    // Named, but unproven. `declared` carries no purchase cap — see
    // lib/webbotauth/tiers.ts.
    tier: 'declared',
    verified: false,
    platformKey: platform.key,
    displayName: platform.displayName,
    owner: platform.owner,
    logoPath: platform.logoPath,
    descopeClientId,
    needsDescopeClient: descopeClientId === null,
  };
}

function unidentified(reason: string, directoryUrl?: string): AgentIdentity {
  return {
    tier: 'unverified',
    verified: false,
    platformKey: null,
    displayName: 'Unidentified agent',
    owner: null,
    logoPath: null,
    descopeClientId: null,
    needsDescopeClient: true,
    directoryUrl,
    reason,
  };
}

/**
 * How the identity is described on the consent screen.
 *
 * The customer is the one deciding, so the difference between proven and
 * claimed has to reach them in words they can act on — not as a tier name.
 */
export function consentDescription(identity: AgentIdentity): string {
  switch (identity.tier) {
    case 'verified-trusted':
      return `${identity.displayName} — verified, and a platform Northbound recognises.`;
    case 'verified-unknown':
      return `${identity.displayName} — verified its identity, but Northbound has no `
        + `relationship with this platform.`;
    case 'declared':
      return `${identity.displayName} — self-declared. This agent did not prove its `
        + `identity, so it can only read your account, never buy anything.`;
    default:
      return 'This agent did not identify itself. It can only read your account.';
  }
}
