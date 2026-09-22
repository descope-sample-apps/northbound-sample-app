import { getAuthorizationServer } from '@/lib/oauth/server';
import { OAuthError } from '@/lib/oauth/errors';

/**
 * Dynamic client registration — RFC 7591.
 *
 * Registration is OPEN. Anyone may register a client without a software
 * statement or prior approval, which is what lets an arbitrary third-party
 * agent complete this flow with no custom code — and is exactly what you would
 * not do in production. The response says so in `demo_notice` rather than
 * leaving the reader to infer it.
 *
 * This handler parses HTTP and nothing else; every decision is the
 * authorization server's.
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: 'invalid_request', error_description: 'body must be JSON' },
      { status: 400 },
    );
  }

  try {
    const registered = await getAuthorizationServer()
      .registerClient(body as Parameters<
        ReturnType<typeof getAuthorizationServer>['registerClient']
      >[0]);

    return Response.json(registered, {
      status: 201,
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof OAuthError) {
      return Response.json(
        { error: error.code, error_description: error.message },
        { status: error.status },
      );
    }
    throw error;
  }
}
