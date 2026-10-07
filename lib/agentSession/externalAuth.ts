import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { customers } from '@/db/schema';

/**
 * Descope's External Authentication flow action: Descope sends the customer to Northbound's
 * own login page with an external_auth_req_id, and once they've signed in here, Northbound
 * tells Descope who they are. The customer approves agents with their Northbound password.
 *
 * Needs DESCOPE_PROJECT_ID and DESCOPE_MANAGEMENT_KEY (and DESCOPE_BASE_URL for a custom domain).
 */

const REQUEST_ID = /^[A-Za-z0-9._~-]{1,256}$/;

/** The request ID from the URL or form, if it's well formed. */
export function externalAuthRequestId(value: unknown): string | undefined {
  return typeof value === 'string' && REQUEST_ID.test(value) ? value : undefined;
}

/**
 * Completes the request for a signed-in customer and returns where to send the browser:
 * the redirectUrl Descope gives back, and only if it's https.
 */
export async function completeExternalAuth(requestId: string, customerId: number): Promise<string> {
  const projectId = process.env.DESCOPE_PROJECT_ID;
  const managementKey = process.env.DESCOPE_MANAGEMENT_KEY;
  if (!projectId || !managementKey) throw new Error('External Authentication is not configured');

  const [customer] = await db.select().from(customers).where(eq(customers.id, customerId)).limit(1);
  if (!customer) throw new Error('no such customer');
  const [givenName, ...rest] = customer.name.split(' ');

  const base = process.env.DESCOPE_BASE_URL || 'https://api.descope.com';
  const response = await fetch(`${base}/v1/mgmt/flow/externalauth/complete`, {
    method: 'POST',
    headers: { authorization: `Bearer ${projectId}:${managementKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      externalAuthReqId: requestId,
      loginId: customer.email,
      emailVerified: customer.emailVerified,
      user: { givenName, familyName: rest.join(' ') || undefined },
    }),
  });
  if (!response.ok) throw new Error(`Descope rejected the request (${response.status})`);

  const { redirectUrl } = (await response.json()) as { redirectUrl?: unknown };
  if (typeof redirectUrl !== 'string' || !redirectUrl.startsWith('https://')) {
    throw new Error('Descope did not return an https redirect');
  }
  return redirectUrl;
}
