import { readFileSync } from 'node:fs';

export type AgentPlatform = {
  /** The button key on /agents, and the stable id used in logs. */
  key: string;
  displayName: string;
  owner: string;
  logoPath: string | null;
  /** Web Bot Auth key-directory hosts that PROVE this platform's identity. */
  directoryHosts: string[];
  /** Whether a PROVEN signature from this platform earns the trusted cap. */
  trusted: boolean;
  /** Environment variable holding this platform's Descope client id. */
  descopeClientIdEnv?: string;
};

type Registry = { platforms: AgentPlatform[] };

let cached: Registry | null = null;

function load(): Registry {
  if (!cached) {
    const path = process.env.NORTHBOUND_AGENT_PLATFORMS_FILE
      ?? 'config/agent-platforms.json';
    cached = JSON.parse(readFileSync(path, 'utf8')) as Registry;
  }
  return cached;
}

export function allPlatforms(): AgentPlatform[] {
  return load().platforms;
}

/** Lookup by proven identity: the host of the key directory that signed. */
export function platformByDirectoryHost(host: string): AgentPlatform | null {
  return load().platforms.find((p) => p.directoryHosts.includes(host)) ?? null;
}

/** Lookup by claimed identity: the button somebody clicked. */
export function platformByKey(key: string): AgentPlatform | null {
  return load().platforms.find((p) => p.key === key) ?? null;
}

/**
 * The Descope Inbound App client representing this platform.
 *
 * Returns null when the platform has no client configured yet. That is a
 * configuration gap, and callers must treat it as one — never as a reason to
 * lower the agent's tier, or a missing environment variable would be
 * indistinguishable from a failed signature.
 */
export function descopeClientIdFor(platform: AgentPlatform | null): string | null {
  if (!platform?.descopeClientIdEnv) return null;
  return process.env[platform.descopeClientIdEnv] ?? null;
}

export function resetRegistryCacheForTests(): void {
  cached = null;
}
