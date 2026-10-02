import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/db/client';
import { tokens, type TokenRecord } from '@/db/schema';

/**
 * The issuance record for a live access token, or null.
 *
 * A JWT signature stays valid after revocation, so verifying it is not enough
 * on its own. This is the check that makes /oauth/revoke mean something: a
 * revoked token stops working immediately rather than fifteen minutes later.
 *
 * Lives here, with the authorization server, rather than in the route handler —
 * token records are the AS's business, and the route should not know how they
 * are stored.
 */
export async function findLiveAccessToken(jti: string): Promise<TokenRecord | null> {
  const [record] = await db.select().from(tokens)
    .where(and(
      eq(tokens.jti, jti),
      eq(tokens.kind, 'access'),
      isNull(tokens.revokedAt),
    ))
    .limit(1);

  if (!record) return null;
  if (record.expiresAt.getTime() <= Date.now()) return null;

  return record;
}
