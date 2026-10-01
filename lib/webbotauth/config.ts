import { readFileSync } from 'node:fs';
import type { AgentTier } from './tiers';
import { classifyAgent } from './tiers';
import type { VerificationResult } from './verify';

type TrustConfig = { trustedHosts: string[] };

let cached: TrustConfig | null = null;

/**
 * Hosts whose signatures earn the trusted cap.
 *
 * Read from config/trusted-agent-platforms.json rather than hardcoded, because
 * this is the list a site operator actually maintains as they strike deals with
 * agent platforms — it is business configuration, not code.
 */
export function trustedHosts(): string[] {
  if (!cached) {
    const path = process.env.NORTHBOUND_TRUSTED_AGENTS_FILE
      ?? 'config/trusted-agent-platforms.json';
    cached = JSON.parse(readFileSync(path, 'utf8')) as TrustConfig;
  }
  return cached.trustedHosts;
}

export function tierFor(result: VerificationResult): AgentTier {
  return classifyAgent(result, trustedHosts());
}

export function resetTrustCacheForTests(): void {
  cached = null;
}
