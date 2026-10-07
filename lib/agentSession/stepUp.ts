import { createHmac } from 'node:crypto';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Customer } from '@/db/schema';
import { getAgentSession } from '@/lib/auth/session-cookie';
import { getCart } from '@/lib/services/cart';

/**
 * Call before placing an order. A person, or an agent whose token has orders:write, passes
 * (returns undefined). Any other agent is redirected to approve this order through the
 * agent-ready front door, or gets an error if step-up isn't configured.
 */
export async function requireOrderApproval(customer: Customer): Promise<{ error: string } | undefined> {
  const agent = await getAgentSession();
  if (!agent || agent.scopes.includes('orders:write')) return undefined;

  const { totalCents } = await getCart(customer.id);
  const origin = (await headers()).get('origin') ?? '';
  const approval = stepUpUrl(customer.email, totalCents, `${origin}/checkout`);
  if (!approval) return { error: "This AI agent needs the customer's approval to place orders." };
  redirect(approval);
}

/**
 * Where to send an agent that needs the customer's approval for one purchase.
 *
 * The agent-ready front door runs a Descope CIBA request whose message names this order, and
 * the agent comes back with a token that allows it. The order is signed with a secret shared
 * with the front door, so the agent can't change what the customer is asked to approve.
 * Returns null when FRONT_DOOR_URL or STEP_UP_SECRET isn't set.
 */
export function stepUpUrl(email: string, totalCents: number, returnTo: string): string | null {
  const frontDoor = process.env.FRONT_DOOR_URL;
  const secret = process.env.STEP_UP_SECRET;
  if (!frontDoor || !secret) return null;

  const order = {
    email,
    amount: `$${(totalCents / 100).toFixed(2)}`,
    exp: Math.floor(Date.now() / 1000) + 300,
  };
  const body = Buffer.from(JSON.stringify(order)).toString('base64url');
  const signature = createHmac('sha256', secret).update(body).digest('base64url');

  const url = new URL('/step-up', frontDoor);
  url.searchParams.set('request', `${body}.${signature}`);
  url.searchParams.set('return_to', returnTo);
  return url.toString();
}
