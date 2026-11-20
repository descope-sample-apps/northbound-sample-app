import { jsonResponse } from '@/lib/api/bearer';
import { withCustomer } from '@/lib/api/appBearer';
import { listAssistants } from '@/lib/agentSession/knownAgents';

export const dynamic = 'force-dynamic';

/** The same list /account/assistants shows, for the customer's own app. */
export const GET = withCustomer(async (_request, session) => {
  const assistants = await listAssistants(session.customer.id);
  return jsonResponse({
    assistants: assistants.map((a) => ({
      id: a.id,
      name: a.product?.name ?? null,
      domain: a.product?.domain ?? null,
      allowed: a.allowed,
      first_seen_at: a.firstSeenAt.toISOString(),
      last_seen_at: a.lastSeenAt.toISOString(),
      orders_placed: a.ordersPlaced,
    })),
  });
});
