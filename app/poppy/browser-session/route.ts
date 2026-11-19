import { SESSION_COOKIE } from '@/lib/auth/session';
import {
  BROWSER_SESSION_COOKIE,
  BROWSER_SESSION_TTL_MS,
  JOIN_CODE_TTL_MS,
  JOIN_COOKIE,
  completeJoin,
  readCookie,
  startJoin,
} from '@/lib/agentSession/browserJoin';

/**
 * The Poppy browser-session endpoint (section 6), steps 1 and 3.
 *
 * GET hands an assistant's browser a one-time code and a cookie that ties the code to
 * that browser. POST takes them both back and, if the assistant authorized the code in
 * between (./authorize), sets the session cookie the browser then browses with.
 *
 * COOKIES ARE SET ON THE RESPONSE, NOT THROUGH next/headers. These handlers are plain
 * Request-to-Response functions so the whole three-request dance is testable without a
 * running Next.js, which is the only way the refusals in 10.6 get tested at all.
 */

// A new code per request. Nothing here may be cached or prerendered.
export const dynamic = 'force-dynamic';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!
  ));
}

/**
 * The headers section 6 requires on the page: not cached, not framed, and not kept as a
 * window reference by whatever opened it. Each one closes a way for another site to read
 * or drive the code out of this page.
 */
const PAGE_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'content-security-policy': "frame-ancestors 'none'",
  'cross-origin-opener-policy': 'same-origin',
};

function joinCookie(value: string, maxAgeSeconds: number): string {
  // __Host- is load-bearing, not decoration: it is what stops another host on
  // northbound.camp setting this cookie, which is the sibling-domain half of the
  // forgery in 10.6. It requires Secure and Path=/ and forbids Domain, so Secure is
  // set even in development — browsers treat localhost as a secure context.
  return `${JOIN_COOKIE}=${value}; Path=/; Max-Age=${maxAgeSeconds}; Secure; HttpOnly; SameSite=Strict`;
}

/**
 * Step 1.
 *
 * Takes no request: nothing about the caller may change what this page does. A code
 * and a cookie, the same for everyone, every time.
 */
export async function GET(): Promise<Response> {
  const { code, joinSecret } = await startJoin();

  // THE FORM MUST NOT SUBMIT ITSELF, which is the one thing about this page that is
  // easy to get wrong. The assistant is driving: it reads the code here, authorizes it
  // at ./authorize, and only then posts the form. A page that posted itself on load
  // would spend the code before it had been authorized — and a code is used by the
  // first submission whatever the result, so every join would fail with nothing to
  // retry. The browser waits.
  const body = `<!doctype html>
<meta charset="utf-8">
<title>Connecting</title>
<form method="post" action="/poppy/browser-session">
  <input type="hidden" name="code" value="${escapeHtml(code)}">
  <button>Continue</button>
</form>
`;

  return new Response(body, {
    status: 200,
    headers: {
      ...PAGE_HEADERS,
      // The ONLY cookie this response sets. "Loading the page MUST NOT start, end, or
      // change any Session, or change the browser's other cookies."
      'set-cookie': joinCookie(joinSecret, JOIN_CODE_TTL_MS / 1000),
    },
  });
}

function errorPage(message: string, status: number): Response {
  return new Response(
    `<!doctype html>\n<meta charset="utf-8">\n<title>Not connected</title>\n<p>${escapeHtml(message)}</p>\n`,
    { status, headers: PAGE_HEADERS },
  );
}

/** Step 3. */
export async function POST(request: Request): Promise<Response> {
  const form = await request.formData().catch(() => null);
  const code = form?.get('code');
  if (typeof code !== 'string' || !code) {
    return errorPage('That link is no longer valid. Start again.', 400);
  }

  const joined = await completeJoin({
    code,
    joinSecret: readCookie(request, JOIN_COOKIE) ?? null,
  });

  if (!joined) {
    // Deliberately one message for every refusal — an unauthorized code, an expired one,
    // a replay, and a browser that never loaded the page. Which check failed is exactly
    // what an attacker probing 10.6's forgery would want to learn.
    return errorPage('That link is no longer valid. Start again.', 400);
  }

  const cookies = [
    `${BROWSER_SESSION_COOKIE}=${joined.cookieValue}; Path=/; Max-Age=${BROWSER_SESSION_TTL_MS / 1000}; Secure; HttpOnly; SameSite=Lax`,
    // Spent: the code it tied is gone, so the cookie goes with it.
    `${JOIN_COOKIE}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict`,
  ];

  // "A join with an access token signs the browser in to the account from step 2 ... in
  // place of any login it had." A signed-out join leaves an existing login alone, because
  // the assistant's browser may have one it cannot easily recreate.
  if (joined.signedIn) {
    cookies.push(`${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
  }

  const headers = new Headers({ location: '/', 'cache-control': 'no-store' });
  for (const cookie of cookies) headers.append('set-cookie', cookie);

  // 303, so the browser follows with a GET rather than re-posting the form.
  return new Response(null, { status: 303, headers });
}
