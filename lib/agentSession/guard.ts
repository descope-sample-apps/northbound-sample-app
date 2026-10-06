import { getAgentSession } from '@/lib/auth/session-cookie';

/**
 * Actions an agent must never take for a customer, even with their approval:
 * the customer does these themselves. Returns the message to show, or null for people.
 */
export async function refuseAgent(action: string): Promise<{ error: string } | null> {
  const session = await getAgentSession();
  if (!session) return null;
  console.log(JSON.stringify({
    event: 'agent_refused',
    action,
    customer_id: session.customer.id,
    agent_client: session.agent.clientId,
    agent_id: session.agent.agentId,
  }));
  return { error: `AI agents can't ${action}. Ask the customer to do this themselves.` };
}

/** Records writes an agent made, so support can tell them apart from the customer's own. */
export async function recordAgentWrite(event: string, details: Record<string, unknown>): Promise<void> {
  const session = await getAgentSession();
  if (!session) return;
  console.log(JSON.stringify({
    event,
    ...details,
    customer_id: session.customer.id,
    agent_client: session.agent.clientId,
    agent_id: session.agent.agentId,
    actor: session.agent.actor,
  }));
}
