/**
 * What an agent is told when its token is refused.
 *
 * Shared by the agent API (lib/api/bearer.ts) and the Poppy browser-session endpoint
 * (app/poppy/browser-session/authorize), because both refuse the same tokens for the
 * same reasons and a deployment that wants to hear one wants to hear the other. Pure
 * string handling, no imports — it is reachable from a route that must not drag a token
 * verifier or a database behind it.
 */

/** The standing refusal, and the whole of it unless a deployment asks for more. */
export const REFUSED = 'The access token is not valid for Northbound.';

/** Beyond this, a reason is truncated rather than let loose in a header. */
const REASON_LIMIT = 200;

/**
 * The refusal, with the reason appended when this deployment has asked for it.
 *
 * OFF BY DEFAULT, AND THAT IS THE RIGHT DEFAULT. The reason names which claim disagreed,
 * or which email had no account — the exact detail that tells whoever is holding a forged
 * or stolen token what to change next. In production an agent gets one sentence and the
 * operator reads `agent_token_rejected` on the log.
 *
 * ON, IT IS WORTH THE TRADE IN A DEMO OR A STAGING DEPLOYMENT. Without it, an agent that
 * signs in, is refused, refreshes, is refused again and falls back to another sign-in
 * looks like a loop with no cause — and the one fact that would end it, usually that the
 * token's email has no account here, is sitting in a log nobody watching the demo can
 * reach. Set AGENT_DEBUG_REFUSALS=true and the agent says it out loud.
 *
 * Exactly the string "true". A flag that also accepted "1", "yes" or "TRUE" would
 * eventually be on somewhere nobody meant it to be.
 *
 * FLATTENED FIRST, BECAUSE THIS ENDS UP IN A HEADER. A reason is whatever went wrong,
 * including a stringified error, and those are not always one line — a database failure
 * arrives as `Failed query: select ...\nparams: ...`. Callers write the description into
 * WWW-Authenticate, where a newline is header injection; undici rejects the value
 * outright, so an unflattened reason turns a 401 into a 500 and the agent learns nothing
 * at all. Anything above U+00FF throws the same way, since a header value is a ByteString,
 * and reasons quote real data like the email on the token, so an accent reaching one is
 * ordinary rather than exotic. Everything outside printable ASCII becomes a space, runs of
 * whitespace collapse, and the result is capped so one enormous SQL error cannot crowd out
 * the header.
 */
export function refusedBecause(reason: string): string {
  if (process.env.AGENT_DEBUG_REFUSALS !== 'true') return REFUSED;

  const flat = reason.replace(/[^ -~]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!flat) return REFUSED;

  const short = flat.length > REASON_LIMIT ? `${flat.slice(0, REASON_LIMIT - 3)}...` : flat;
  return `${REFUSED.slice(0, -1)} (${short}).`;
}
