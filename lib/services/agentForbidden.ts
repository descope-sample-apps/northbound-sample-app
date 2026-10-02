import { AgentForbiddenError } from './errors';
import type { ActorContext } from '@/lib/oauth/types';

/**
 * Operations closed to agents outright.
 *
 * Not "requires a scope" — CLOSED. There is no scope, no tier and no consent
 * screen that opens them, which is why the check is on the presence of `act`
 * rather than on anything in the token's permissions.
 *
 * Payment methods and credentials are the two places where an agent going wrong
 * is unrecoverable for the customer: a stored card it added outlives the grant,
 * and a changed password locks the customer out of their own account. Reading
 * their order history, by contrast, is embarrassing at worst.
 *
 * `payment_methods:write` exists as a scope so the storefront's own vocabulary
 * is complete and so the refusal is explicit rather than an omission — but no
 * tier ever grants it, and this check would refuse it even if one did.
 */
export function refuseAgents(ctx: ActorContext, what: string): void {
  if (ctx.actor === null) return;

  throw new AgentForbiddenError(
    `${what} cannot be done by an agent. Northbound refuses this for every `
    + `agent, however it was authorized — the account holder has to do it `
    + `themselves.`,
  );
}
