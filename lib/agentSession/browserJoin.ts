import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/db/client';
import { agentBrowserSessions, browserJoinCodes } from '@/db/schema';
import { resolveAgentToken, type AgentSession } from './descope';

/**
 * Poppy section 6: joining an assistant's browser to its Session.
 *
 * Northbound's agents already reach the API with a bearer token and the storefront
 * through Agent Edge's own DS cookie. Neither is the protocol's browser join, and
 * an assistant that only speaks Poppy had no way in. This is that way in.
 *
 * THE SHAPE, AND WHY IT IS THIS SHAPE. A join takes three requests from two callers
 * who never meet. The browser loads a page and comes away with a code and a cookie it
 * cannot read. The assistant authorizes that code in a request of its own, carrying the
 * access token. The browser posts the code back with its cookie, and only then is a
 * session cookie set. Neither caller can finish alone, which is the entire security
 * argument of section 10.6: an attacker who authorizes a code in their own browser and
 * then gets a victim's browser to post it fails, because the victim's browser does not
 * carry the cookie that code was issued against.
 *
 * No Next.js imports, so this runs in plain Node under vitest, the same rule
 * lib/auth/session.ts follows. The routes do the HTTP.
 */

/** Ties a code to the browser that was handed it. Short-lived, HttpOnly, __Host-. */
export const JOIN_COOKIE = '__Host-poppy_join';

/** The cookie a joined browser then carries. Opaque: the token stays on the server. */
export const BROWSER_SESSION_COOKIE = '__Host-nb_agent_browser';

/**
 * How long a code lives. Section 6 has the assistant "complete steps 2 and 3 right
 * away", and the window is the one thing an attacker needs to land both halves of
 * 10.6's forgery in, so it is a minute rather than a convenience.
 */
export const JOIN_CODE_TTL_MS = 60 * 1000;

/**
 * How long a joined browser's cookie lives.
 *
 * Section 6 says the cookie "MUST NOT outlive the Session", and nothing tells this
 * store when the Session ends — the Session is the assistant's, and Agent Edge sees
 * the header. An hour is the shortest honest cap: it matches a Descope access token's
 * usual life, so a signed-in join's cookie expires about when the credential behind it
 * would have. The MUST is really met by resolveBrowserJoin below, which re-checks the
 * token on every request rather than trusting this number.
 */
export const BROWSER_SESSION_TTL_MS = 60 * 60 * 1000;

/** The scope that lets a join sign the browser in (section 6). */
export const SCOPE_BROWSER_SIGN_IN = 'poppy:browser-sign-in';

const CODE_PREFIX = 'bc_';

function secret(): string {
  return randomBytes(24).toString('base64url');
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Constant-time compare of two hex digests.
 *
 * The join cookie is a secret an attacker is actively trying to guess, and `===` on a
 * string leaks how much of it was right through how long the comparison took. The
 * digests are fixed length, so there is no length to leak.
 */
function sameSecret(presented: string, storedHash: string): boolean {
  const a = Buffer.from(hash(presented), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Step 1: a fresh code, and the secret the browser's cookie carries. */
export async function startJoin(): Promise<{ code: string; joinSecret: string; expiresAt: Date }> {
  const code = CODE_PREFIX + secret();
  const joinSecret = secret();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + JOIN_CODE_TTL_MS);

  await db.insert(browserJoinCodes).values({
    code,
    joinSecretHash: hash(joinSecret),
    issuedAt: now,
    expiresAt,
    authorizedAt: null,
    poppySession: null,
    accessToken: null,
    consumedAt: null,
  });

  return { code, joinSecret, expiresAt };
}

/**
 * Step 2: the assistant authorizes a code, for a Session and optionally an account.
 *
 * Returns false for a code this store never issued, one that has expired, one already
 * authorized, and one already submitted — all of which section 6 answers the same way,
 * with `{"error": "invalid_request"}`. They are not told apart on purpose: distinguishing
 * "expired" from "never existed" is a probe for which codes are live.
 */
export async function authorizeJoin(input: {
  code: string;
  poppySession: string;
  accessToken: string | null;
}): Promise<boolean> {
  const now = new Date();

  // One conditional UPDATE rather than a read and a write, so two assistants racing the
  // same code cannot both come away believing they authorized it.
  const updated = await db
    .update(browserJoinCodes)
    .set({ authorizedAt: now, poppySession: input.poppySession, accessToken: input.accessToken })
    .where(and(
      eq(browserJoinCodes.code, input.code),
      isNull(browserJoinCodes.authorizedAt),
      isNull(browserJoinCodes.consumedAt),
    ))
    .returning({ expiresAt: browserJoinCodes.expiresAt });

  if (updated.length === 0) return false;

  // Expiry is checked after the claim, not in the WHERE clause: a code that has run out
  // is spent either way, so claiming it first stops it being retried.
  return updated[0].expiresAt.getTime() > now.getTime();
}

export type CompletedJoin = {
  /** The value for the browser's session cookie. */
  cookieValue: string;
  /** Whether step 2 carried an access token — which decides what happens to any login. */
  signedIn: boolean;
};

/**
 * Step 3: the browser posts the code back, and the join either completes or dies.
 *
 * "A code is used by the first request that submits it, whatever the result", so the
 * code is consumed BEFORE anything about the request is judged. A forged submission
 * that fails the cookie check still burns the code, which is what stops an attacker
 * retrying against a victim's browser until one lands.
 */
export async function completeJoin(input: {
  code: string;
  joinSecret: string | null;
}): Promise<CompletedJoin | null> {
  const now = new Date();

  const claimed = await db
    .update(browserJoinCodes)
    .set({ consumedAt: now })
    .where(and(eq(browserJoinCodes.code, input.code), isNull(browserJoinCodes.consumedAt)))
    .returning();

  const row = claimed[0];
  if (!row) return null;
  if (!row.authorizedAt) return null;
  if (row.expiresAt.getTime() <= now.getTime()) return null;
  if (!input.joinSecret || !sameSecret(input.joinSecret, row.joinSecretHash)) return null;

  const cookieValue = secret();
  await db.insert(agentBrowserSessions).values({
    id: hash(cookieValue),
    poppySession: row.poppySession ?? '',
    accessToken: row.accessToken,
    createdAt: now,
    expiresAt: new Date(now.getTime() + BROWSER_SESSION_TTL_MS),
    revokedAt: null,
  });

  return { cookieValue, signedIn: row.accessToken !== null };
}

/**
 * The account a joined browser acts as, or null when it acts as nobody.
 *
 * Null covers two different things that look the same from here: a browser whose join
 * carried no access token — signed out, requests still belong to the Session — and one
 * whose token no longer works. The second is the point. Section 6 requires the cookie
 * to "stop acting for the account when the User signs out or disconnects the Personal
 * Agent", so the token is re-resolved on every request, which runs Descope's
 * introspection check. A snapshot of the account taken at join time would keep acting
 * for an assistant the customer had already disconnected.
 */
export async function resolveBrowserJoin(cookieValue: string): Promise<AgentSession | null> {
  if (!cookieValue) return null;

  const [row] = await db
    .select()
    .from(agentBrowserSessions)
    .where(and(eq(agentBrowserSessions.id, hash(cookieValue)), isNull(agentBrowserSessions.revokedAt)))
    .limit(1);

  if (!row) return null;
  if (row.expiresAt.getTime() <= Date.now()) return null;
  if (!row.accessToken) return null;

  return resolveAgentToken(row.accessToken);
}

/**
 * Ends a join server-side, so the cookie is dead even if the browser keeps it.
 *
 * Called when the browser signs out on the website, which section 6 lists among the
 * things that end the Session's sign-in.
 */
export async function endBrowserJoin(cookieValue: string): Promise<void> {
  if (!cookieValue) return;
  await db
    .update(agentBrowserSessions)
    .set({ revokedAt: new Date() })
    .where(eq(agentBrowserSessions.id, hash(cookieValue)));
}

/** One cookie out of a request's Cookie header. */
export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get('cookie');
  if (!header) return undefined;

  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return undefined;
}
