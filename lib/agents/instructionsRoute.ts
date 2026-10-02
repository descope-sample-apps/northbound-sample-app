import { resolveIssuer } from '@/lib/oauth/issuer';
import { agentInstructions } from './instructions';

/**
 * One handler, three URLs.
 *
 * `auth.md` and `agents.md` are competing conventions with uneven adoption, and
 * the cost of serving both is a route file. An agent that finds neither is the
 * failure this file exists to prevent, so guessing which one will win is not
 * worth the risk.
 *
 * Content-Type is text/markdown rather than text/plain, so a client that
 * content-negotiates sees what it is.
 */
export function serveInstructions(request: Request): Response {
  return new Response(agentInstructions(resolveIssuer(request)), {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      // Advertised URLs are derived from the host, so a cached copy served to
      // another host would send an agent to the wrong place.
      'cache-control': 'no-store',
    },
  });
}
