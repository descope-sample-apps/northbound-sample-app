/**
 * Which product an assistant is, from the client ID in its token.
 *
 * The token's `act.sub` is the OAuth client ID of the app acting for the customer —
 * Descope's token exchange documents it as exactly that — so it already identifies
 * the product, just not in words anyone would recognize. `agt_2xK9pQmR` tells a
 * customer nothing; "Muse" tells them whether to be surprised.
 *
 * THE MAPPING IS CONFIGURATION, NOT A GUESS. Client IDs are issued per Descope
 * project, and Poppy agents register dynamically, so there is no global registry to
 * look them up in and nothing in the ID itself to parse. AGENT_CLIENTS names the ones
 * this store knows; everything else is shown as a third-party agent with its raw ID,
 * which is honest rather than silent.
 *
 * A store that would rather not maintain a list can read the registered client's
 * metadata from Descope instead — dynamic registration records `client_name` and
 * `client_uri` — at the cost of a Management API call and a cache.
 */

export type AgentProduct = {
  /** What the customer would call it, such as "Muse". */
  name: string;
  /** Who operates it, such as "muse.ai". The part worth trusting. */
  domain: string;
};

let cache: { raw: string | undefined; map: Record<string, AgentProduct> } | undefined;

/**
 * Parsed per distinct value rather than once, so a test or a redeploy that changes the
 * setting is picked up. A value that doesn't parse costs the names and nothing else:
 * every assistant still appears, just unnamed.
 */
function knownClients(): Record<string, AgentProduct> {
  const raw = process.env.AGENT_CLIENTS;
  const cached = cache;
  if (cached && cached.raw === raw) return cached.map;

  const map: Record<string, AgentProduct> = {};
  if (raw?.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('not a JSON object');
      }
      for (const [clientId, value] of Object.entries(parsed)) {
        const { name, domain } = (value ?? {}) as Record<string, unknown>;
        if (typeof name === 'string' && name && typeof domain === 'string' && domain) {
          map[clientId] = { name, domain };
        } else {
          console.warn(JSON.stringify({
            event: 'agent_client_ignored',
            reason: 'needs a name and a domain',
            clientId,
          }));
        }
      }
    } catch (error) {
      console.warn(JSON.stringify({ event: 'config_error', error: `AGENT_CLIENTS ${String(error)}` }));
    }
  }

  cache = { raw, map };
  return map;
}

/** The product behind a client ID, or null when this store has no name for it. */
export function identifyAgent(clientId: string): AgentProduct | null {
  return knownClients()[clientId] ?? null;
}

/** Test seam. */
export function resetAgentProductCache(): void {
  cache = undefined;
}
