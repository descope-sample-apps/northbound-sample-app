import type { Customer } from '@/db/schema';
import { resolveCustomerToken } from '@/lib/appSession/descope';
import { ServiceError } from '@/lib/services/errors';
import { jsonResponse, statusFor } from './bearer';

/**
 * The customer app API's gate: the customer's own Descope session, never an agent's.
 *
 * DELIBERATELY UNLIKE withAgent. A refusal here carries no WWW-Authenticate challenge and no
 * resource_metadata, because nothing should be able to discover this API from a 401 and go
 * looking for an authorization server to get a token for it. The only client is the
 * Northbound app, which already knows how to sign the customer in.
 */
export type CustomerContext = { customer: Customer; email: string };

export function withCustomer<C = unknown>(
  handler: (request: Request, session: CustomerContext, context: C) => Promise<Response>,
) {
  return async (request: Request, context: C): Promise<Response> => {
    const header = request.headers.get('authorization') ?? '';
    const match = /^Bearer\s+(\S+)$/i.exec(header);
    const session = match ? await resolveCustomerToken(match[1]) : null;
    if (!session) return jsonResponse({ error: 'invalid_token' }, 401);
    try {
      return await handler(request, session, context);
    } catch (error) {
      if (error instanceof ServiceError) {
        return jsonResponse({ error: error.code, error_description: error.message }, statusFor(error));
      }
      throw error;
    }
  };
}
