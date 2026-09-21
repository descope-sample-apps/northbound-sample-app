import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { customers } from '@/db/schema';
import { verifyPassword, dummyVerify } from './password';
import { verifyLegacyCredential } from '@/app/legacy-auth/verify/route';

export type VerifyResult = { ok: boolean; customerId?: number };

/**
 * Calls the simulated legacy auth backend.
 *
 * When LEGACY_AUTH_URL is set the call is a real server-to-server HTTP request,
 * which is what a retailer wrapping a system it does not own would actually do
 * — and what makes the boundary demonstrable on a network trace. When it is
 * not set (tests, and `pnpm dev` out of the box) the same handler is invoked
 * in-process so the app runs with no second service.
 *
 * Either way the credential goes server -> server. It never reaches a
 * browser-visible endpoint, an OAuth client, or an agent.
 */
async function callLegacyBackend(
  email: string,
  password: string,
): Promise<{ ok: boolean; legacyUserId?: number }> {
  const url = process.env.LEGACY_AUTH_URL;
  if (!url) return verifyLegacyCredential(email, password);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Legacy-Service-Token': process.env.LEGACY_AUTH_SERVICE_TOKEN ?? '',
    },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) return { ok: false };
  const body = (await res.json()) as { ok?: boolean; legacy_user_id?: number };
  return body.ok ? { ok: true, legacyUserId: body.legacy_user_id } : { ok: false };
}

/**
 * SECURITY BOUNDARY — where a customer's credential is checked.
 *
 * The plaintext password arrives from Northbound's own login form. Depending on
 * which backend owns the account this either verifies it locally or forwards it
 * to the legacy service. In neither case does the credential leave the server,
 * and in neither case can a caller tell WHICH backend answered — both branches
 * return the identical shape, so the response does not disclose that a given
 * account is a migrated one.
 *
 * Sub-project C's authorization experience calls this same function. That is
 * deliberate: it is genuine shared authentication logic, not agent scaffolding
 * leaking into the storefront. The agent never calls it and never sees its input.
 */
export async function verifyCredentials(
  email: string,
  password: string,
): Promise<VerifyResult> {
  const normalized = email.trim().toLowerCase();

  // An empty password can never be valid; reject before touching a backend.
  if (!password) {
    await dummyVerify(password);
    return { ok: false };
  }

  const [customer] = await db
    .select()
    .from(customers)
    .where(eq(customers.email, normalized))
    .limit(1);

  // Constant-work path so response timing does not enumerate accounts.
  if (!customer) {
    await dummyVerify(password);
    return { ok: false };
  }

  if (customer.authBackend === 'legacy') {
    // The credential belongs to a system we do not control. We forward it; we
    // never copy it into customers.password_hash, because doing so would be a
    // silent migration of exactly the data this boundary exists to leave alone.
    const result = await callLegacyBackend(normalized, password);
    return result.ok ? { ok: true, customerId: customer.id } : { ok: false };
  }

  if (!customer.passwordHash) {
    await dummyVerify(password);
    return { ok: false };
  }

  const ok = await verifyPassword(password, customer.passwordHash);
  return ok ? { ok: true, customerId: customer.id } : { ok: false };
}
