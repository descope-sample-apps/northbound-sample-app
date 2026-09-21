// ============================================================================
// SIMULATED LEGACY AUTHENTICATION BACKEND
// ============================================================================
// This route stands in for a 2019 authentication service that Northbound does
// not own. It is the ONLY module permitted to import db/schema/legacy.ts, and
// a test in test/legacy-auth.test.ts enforces that.
//
// SECURITY BOUNDARY — the load-bearing one for this whole project:
//
//   The customer's password is typed into Northbound's OWN form, posted to
//   Northbound's OWN server, and forwarded from there to this backend over a
//   server-side channel authenticated with a service token.
//
//   It never reaches a browser-visible endpoint, and in sub-project C it will
//   never reach the OAuth client or the agent. The agent obtains a token; it
//   never obtains, observes, or replays the credential. That asymmetry is the
//   entire argument for putting an OAuth boundary in front of an agent instead
//   of handing it a password or a browser session.
//
// This is the Descope Generic HTTP Connector pattern: the authorization
// experience calls an existing credential store over HTTP rather than
// migrating its password hashes into a new system.
//
// Note it is deliberately NOT mounted under /api/*, so it never collides with
// the bearer-only rule sub-project B enforces on that namespace.
// ============================================================================
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { legacyCredentials } from '@/db/schema/legacy';
import { verifyPassword, dummyVerify } from '@/lib/auth/password';

const BodySchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

/**
 * Exported for the storefront login action and, later, the authorization
 * server — both of which call it through the HTTP route above rather than
 * importing it, so that the network boundary in the demo is a real one.
 */
export async function verifyLegacyCredential(
  email: string,
  password: string,
): Promise<{ ok: boolean; legacyUserId?: number }> {
  const [row] = await db
    .select()
    .from(legacyCredentials)
    .where(eq(legacyCredentials.email, email.trim().toLowerCase()))
    .limit(1);

  // Constant-work path: an unknown email costs the same as a wrong password,
  // so response timing does not enumerate the legacy user list.
  if (!row) {
    await dummyVerify(password);
    return { ok: false };
  }

  const ok = await verifyPassword(password, row.passwordHash);
  return ok ? { ok: true, legacyUserId: row.legacyUserId } : { ok: false };
}

export async function POST(request: Request): Promise<Response> {
  // The service token is checked BEFORE the body is read. An unauthenticated
  // caller must not be able to probe the credential store by sending garbage
  // and reading which error comes back.
  const expected = process.env.LEGACY_AUTH_SERVICE_TOKEN;
  const presented = request.headers.get('X-Legacy-Service-Token');
  if (!expected || presented !== expected) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  let parsed: z.infer<typeof BodySchema>;
  try {
    const result = BodySchema.safeParse(await request.json());
    if (!result.success) {
      return Response.json({ error: 'invalid_request' }, { status: 400 });
    }
    parsed = result.data;
  } catch {
    return Response.json({ error: 'invalid_request' }, { status: 400 });
  }

  const result = await verifyLegacyCredential(parsed.email, parsed.password);
  return result.ok
    ? Response.json({ ok: true, legacy_user_id: result.legacyUserId })
    : Response.json({ ok: false });
}
