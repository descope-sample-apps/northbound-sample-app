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
 * This removes a whole class of mistake. A JWT session cookie would be SHAPED
 * like a bearer token: any generic middleware that verifies a signature would
 * accept it, and the only thing stopping it reaching an API would be a check a
 * future contributor might not preserve. This value carries no signature and no
 * claims, so nothing can validate it by inspection — it means something only
 * after a deliberate lookup against the `sessions` table.
 *
 * Be precise about what that does and does not buy. It does NOT make presenting
 * a session to an API impossible: `resolveSession` below is exported, takes a
 * string, and would happily answer if some future handler called it. What it
 * buys is that doing so requires writing that call on purpose. When sub-project
 * B adds access tokens, they belong in their own table with their own resolver,
 * so the two can never be confused by a shared code path.
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
