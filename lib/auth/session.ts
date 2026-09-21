import { randomBytes } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/db/client';
import { customers, sessions, type Customer } from '@/db/schema';

export const SESSION_COOKIE = 'nb_session';
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

/**
 * SECURITY BOUNDARY — why this token is opaque.
 *
 * The value below is 32 random bytes rendered as hex. It carries no claims, no
 * signature, and no meaning outside the `sessions` table.
 *
 * This is a STRUCTURAL answer to the requirement that the agent API must never
 * accept a browser session. A JWT session cookie would be SHAPED like a bearer
 * token, and the only thing stopping someone presenting it to /api/* would be
 * a check that a future contributor might not think to preserve. An opaque
 * database token cannot be validated as an access token by any code path —
 * including code written by someone who never read the test.
 *
 * This module deliberately has no Next.js imports so that it stays usable from
 * plain Node (tests today, the authorization server in sub-project C).
 * Request-bound helpers live in ./session-cookie.
 */
export async function createSession(
  customerId: number,
  userAgent?: string,
): Promise<string> {
  const token = randomBytes(32).toString('hex');
  const now = new Date();

  await db.insert(sessions).values({
    id: token,
    customerId,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
    revokedAt: null,
    userAgent: userAgent ?? null,
  });

  return token;
}

/** Fails closed: missing, malformed, expired, and revoked all resolve to null. */
export async function resolveSession(token: string): Promise<Customer | null> {
  if (!token || !TOKEN_PATTERN.test(token)) return null;

  const [row] = await db
    .select({ session: sessions, customer: customers })
    .from(sessions)
    .innerJoin(customers, eq(sessions.customerId, customers.id))
    .where(and(eq(sessions.id, token), isNull(sessions.revokedAt)))
    .limit(1);

  if (!row) return null;
  if (row.session.expiresAt.getTime() <= Date.now()) return null;

  await db.update(sessions)
    .set({ lastSeenAt: new Date() })
    .where(eq(sessions.id, token));

  return row.customer;
}

/** Revokes server-side, so a copied cookie is dead even if the client keeps it. */
export async function revokeSession(token: string): Promise<void> {
  if (!token || !TOKEN_PATTERN.test(token)) return;
  await db.update(sessions)
    .set({ revokedAt: new Date() })
    .where(eq(sessions.id, token));
}
