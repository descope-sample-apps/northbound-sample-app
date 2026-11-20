import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function sourceFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.tsx?$/.test(path)) out.push(path);
  }
  return out;
}

/** Comments explain the boundary; only code is judged by it. */
function stripComments(source: string): string {
  return source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

// `lib` is included deliberately. An earlier version of this file scanned only
// ['app', 'lib/services', 'components'], which meant the enforcement test could
// not see lib/auth/ — the very directory where the credential code lives, and
// where sub-project B will add OAuth code. A guard with a blind spot over the
// thing it guards is worse than no guard, because it reports green.
const STOREFRONT_DIRS = ['app', 'lib', 'components'];

/** The one module the spec permits to reach the legacy credential store. */
const LEGACY_ROUTE = join('app', 'legacy-auth', 'verify', 'route.ts');

/**
 * The Poppy discovery document: in production Agent Edge's Worker serves it, and this
 * is the sample implementation of what it publishes. The one exception to the two rules
 * below — it trips the vocabulary scan on `scopes`, a key name the Poppy schema requires.
 */
const POPPY_ROUTE = join('app', '.well-known', 'poppy.json', 'route.ts');

/**
 * THE GRAFT. Agent access arrives through Agent Edge's Cloudflare Worker and front
 * door, which hand the agent's browser a Descope token in a cookie. Everything else
 * an agent needs happens at the edge, so all of Northbound's agent code is token
 * validation, and it lives in this one directory.
 */
const AGENT_DIR = join('lib', 'agentSession');

/**
 * THE GRAFT'S SECOND HALF: the agent API.
 *
 * Sub-project A's design listed "any /api/* surface" as a non-goal, and this file used to
 * assert `app/api` did not exist at all. That rule did its job — the storefront was built
 * and shipped with no API in it, so the diff that adds one is still a graft and not
 * something written in anticipation of ourselves. This is that diff.
 *
 * WHY IT HAD TO LAND HERE. northbound.camp published a Poppy document naming an issuer and
 * two scopes and then listed no API, so an agent could sign the customer in and had
 * nowhere to spend the Session: "where is my parka" failed as a protocol error, correctly.
 * The orders are in this repository's database and the rules about them are in
 * lib/services, so an API that did not reinvent both had to be here too. Agent Edge's
 * worker could not host it — it runs in front of the site, generic to any store, with no
 * access to an order.
 *
 * WHAT STAYS TRUE. The storefront itself is unchanged: not one page, action or service
 * learned a thing about tokens. The vocabulary scan below still covers every storefront
 * file, and these two directories are excluded the same way lib/agentSession is, because
 * the exclusion is what makes the boundary legible — agent code is in named places, and
 * anything outside them that reaches for a scope still fails this suite.
 */
const AGENT_API_DIRS = [join('app', 'api', 'agent'), join('lib', 'api')];

/**
 * The agent API's protected resource metadata (RFC 9728). It lives at a path derived from
 * the API's own URL rather than next to it, which is why it is a storefront file by
 * location and agent code by content.
 */
const AGENT_METADATA_ROUTE = join(
  'app', '.well-known', 'oauth-protected-resource', 'api', 'agent', 'v1', 'route.ts',
);

function inAgentApi(file: string): boolean {
  return AGENT_API_DIRS.some((dir) => file.startsWith(dir));
}

/**
 * THE GRAFT'S THIRD HALF: Poppy's browser join (spec section 6).
 *
 * The two above cover an assistant that calls the API with a token, and an assistant
 * that arrives through Agent Edge's front door and gets its cookie. Neither is the
 * protocol's own way onto a website. An assistant that speaks only Poppy loads a page
 * here, has the code it is given authorized out of band, and posts it back for a
 * cookie — three requests this store has to serve itself.
 *
 * WHY IT COULD NOT LIVE AT THE EDGE, which is where every other piece of agent
 * machinery went. Step 3 has to set a cookie that means something to Northbound, and
 * step 2 has to record which account and scopes it stands for. The worker in front has
 * no customer, no session table and no notion of orders:write, so a join it completed
 * would hand back a cookie this store could not read. It is the same argument that
 * brought the agent API here: the thing being authorized lives in this database.
 *
 * WHY IT IS A DIRECTORY AND NOT A LINE IN AGENT_AWARE_FILES. These routes are not
 * storefront files reaching into the graft; they ARE graft, in a named place, like
 * app/api/agent. The storefront's own half of this change is one file — the cookie
 * lookup in lib/auth/session-cookie.ts, already listed below — and that is the number
 * this boundary exists to keep honest.
 */
const BROWSER_SESSION_DIR = join('app', 'poppy', 'browser-session');

function inBrowserSession(file: string): boolean {
  return file.startsWith(BROWSER_SESSION_DIR);
}

/**
 * The only storefront files that import the agent code: the session lookup, checkout's
 * step-up, login's External Authentication, the account write gate, the page that shows
 * a customer which assistants have acted for them, and the two order views that name the
 * assistant which placed an order.
 *
 * THE LAST FOUR WIDEN THE GRAFT, AND THAT IS THE POINT OF LISTING THEM. An assistant is
 * no longer only something the edge deals with before a request arrives. A customer can
 * see one in their own account, the store refuses one that tries to change account data,
 * and an order now says which assistant placed it and links to what else that assistant
 * may do. Those are storefront features — a customer asking "who bought this?" is asking
 * a question about their own order, not about OAuth — so they belong in storefront files,
 * and this list is what keeps that growth visible in a diff rather than ambient.
 *
 * The order views import nothing but the client-ID-to-name mapping. They do not read a
 * token, a scope or a session; `orders.placed_by_agent` is already theirs. If one of them
 * ever reaches for lib/agentSession for anything else, that is a different change and
 * deserves a different argument.
 *
 * The customer app API (lib/appSession, app/api/app) is the same storefront feature on the
 * phone: the customer's own session, never an agent's. It reaches in for the demo signup the
 * agent path already does, and for the assistants list the account page shows.
 */
const AGENT_AWARE_FILES = [
  join('app', 'account', 'actions.ts'),
  join('app', 'account', 'assistants', 'page.tsx'),
  join('app', 'checkout', 'actions.ts'),
  join('app', 'login', 'actions.ts'),
  join('app', 'login', 'page.tsx'),
  join('app', 'orders', '[orderNumber]', 'page.tsx'),
  join('app', 'orders', 'page.tsx'),
  join('lib', 'appSession', 'descope.ts'),
  join('lib', 'auth', 'session-cookie.ts'),
].sort();

describe('the Agent Edge graft stays contained', () => {
  it('is referenced only from the files listed in AGENT_AWARE_FILES', () => {
    const users = STOREFRONT_DIRS.flatMap((d) => sourceFiles(d))
      .filter((file) => !file.startsWith(AGENT_DIR))
      // The agent API is the graft's other half, not a storefront file reaching into it.
      // Its own containment is the rule above: nothing outside these named directories
      // may speak about tokens or scopes at all.
      .filter((file) => !inAgentApi(file))
      .filter((file) => !inBrowserSession(file))
      .filter((file) => /@\/lib\/agentSession\//.test(readFileSync(file, 'utf8')))
      .sort();
    expect(users).toEqual(AGENT_AWARE_FILES);
  });
});

describe('sub-project A contains no agent concepts', () => {
  // The thesis of this project is that agent access is GRAFTED ONTO a retailer
  // that already exists. If the storefront ships with agent scaffolding baked
  // in, sub-project B's diff stops demonstrating that and instead demonstrates
  // code we wrote in anticipation of ourselves. This test is what keeps the
  // claim true as the repository grows.
  it('uses no OAuth, agent, scope or policy vocabulary in storefront code', () => {
    const offenders: string[] = [];

    for (const file of STOREFRONT_DIRS.flatMap((d) => sourceFiles(d))) {
      if (file === LEGACY_ROUTE) continue;
      if (file === POPPY_ROUTE) continue;
      if (file === AGENT_METADATA_ROUTE) continue;
      if (file.startsWith(AGENT_DIR)) continue;
      if (inAgentApi(file)) continue;
      if (inBrowserSession(file)) continue;

      const code = stripComments(readFileSync(file, 'utf8'));
      const matches = code.match(
        /\b(oauth|bearer|access_token|refresh_token|ActorContext|authorization_details|scopes?|policyEngine)\b/gi,
      );
      if (matches) offenders.push(`${file}: ${[...new Set(matches)].join(', ')}`);
    }

    expect(offenders).toEqual([]);
  });

  // The storefront's own route surface, which has not grown: the discovery document and
  // the legacy credential checker, exactly as before. Everything the agent API adds is
  // under app/api/agent, and nothing else may appear under app/api at all — a route
  // handler for the storefront's own pages would be a page, not an endpoint.
  it('adds no routes to the storefront, and nothing under /api outside the agent API', () => {
    const routes = sourceFiles('app').filter((f) => /route\.tsx?$/.test(f)).sort();
    const storefront = routes.filter((f) =>
      !inAgentApi(f) && !inBrowserSession(f) && f !== AGENT_METADATA_ROUTE);

    expect(storefront).toEqual([POPPY_ROUTE, LEGACY_ROUTE].sort());
    expect(sourceFiles(join('app', 'api')).filter((f) => !inAgentApi(f))).toEqual([]);
  });

  // Named one by one, so adding an endpoint is a line in this file and therefore a line
  // in a reviewer's diff. The same reason AGENT_AWARE_FILES is a list rather than a glob.
  it('exposes exactly the agent endpoints it means to', () => {
    const routes = sourceFiles('app')
      .filter((f) => /route\.tsx?$/.test(f))
      .filter((f) => inAgentApi(f) || inBrowserSession(f) || f === AGENT_METADATA_ROUTE)
      .sort();

    expect(routes).toEqual([
      AGENT_METADATA_ROUTE,
      // Poppy section 6. Two handlers, not three: the endpoint itself serves step 1 on
      // GET and step 3 on POST, and /authorize is step 2 — the only one of the three an
      // assistant makes itself, and the only one that ever sees an access token.
      join('app', 'poppy', 'browser-session', 'authorize', 'route.ts'),
      join('app', 'poppy', 'browser-session', 'route.ts'),
      join('app', 'api', 'agent', 'v1', 'cart', 'items', 'route.ts'),
      join('app', 'api', 'agent', 'v1', 'cart', 'route.ts'),
      join('app', 'api', 'agent', 'v1', 'checkout-options', 'route.ts'),
      join('app', 'api', 'agent', 'v1', 'openapi.json', 'route.ts'),
      join('app', 'api', 'agent', 'v1', 'orders', '[orderNumber]', 'route.ts'),
      join('app', 'api', 'agent', 'v1', 'orders', 'route.ts'),
      join('app', 'api', 'agent', 'v1', 'products', 'route.ts'),
    ].sort());
  });

  // The API is a surface over the services, not a second implementation of them. Every
  // rule about who may read an order or what a cart costs stays in lib/services, where
  // the storefront calls the same functions — which is what keeps the two from drifting
  // into disagreeing about the same customer's data.
  it('builds the agent API on the services rather than on the database', () => {
    const offenders = AGENT_API_DIRS
      .flatMap((dir) => sourceFiles(dir))
      .filter((file) => {
        // A type import is not a query: shapes.ts names the row types it serializes.
        // Only those lines are forgiven, so `import { db }` still fails.
        const code = stripComments(readFileSync(file, 'utf8'))
          .replace(/^import type .*$/gm, '');
        return /@\/db\//.test(code);
      });

    expect(offenders).toEqual([]);
  });

  // The discovery document is a published file, not an entry point: it reads one
  // environment variable and returns JSON. If it ever imports the agent code, it has
  // stopped being a document and this rule should start failing again.
  it('serves the discovery document without reaching into the agent code', () => {
    const code = stripComments(readFileSync(POPPY_ROUTE, 'utf8'));
    expect(code).not.toMatch(/@\/lib\/agentSession\//);
    expect(code).not.toMatch(/\bdb\b|drizzle/);
  });
});

describe('the legacy credential store stays isolated', () => {
  it('has its schema imported by exactly one module', () => {
    const importers = STOREFRONT_DIRS
      .flatMap((d) => sourceFiles(d))
      .filter((file) => /schema\/legacy/.test(readFileSync(file, 'utf8')));

    expect(importers).toEqual([LEGACY_ROUTE]);
  });

  // Spec 3.3 says every caller other than the route handler reaches the legacy
  // backend OVER HTTP. lib/auth/verify.ts imports the route's exported checker
  // and calls it in process whenever LEGACY_AUTH_URL is unset — which is the
  // default, so the app runs as one process with no second service.
  //
  // That is a deliberate, documented deviation, not an accident. This test
  // pins it to exactly one file so a second in-process caller cannot appear
  // quietly, and so the exemption stays visible to anyone reading the suite.
  it('is called in process by exactly one documented module', () => {
    const importers = STOREFRONT_DIRS
      .flatMap((d) => sourceFiles(d))
      .filter((file) => file !== LEGACY_ROUTE)
      .filter((file) =>
        /from\s+['"]@\/app\/legacy-auth\/verify\/route['"]/
          .test(stripComments(readFileSync(file, 'utf8'))));

    expect(importers).toEqual([join('lib', 'auth', 'verify.ts')]);
  });

  it('documents the env var that turns the HTTP hop on', () => {
    const example = readFileSync('.env.example', 'utf8');
    expect(example).toMatch(/LEGACY_AUTH_URL/);
    expect(example).toMatch(/LEGACY_AUTH_SERVICE_TOKEN/);
  });
});

describe('services own the database', () => {
  // If pages could query directly, the storefront's read path and the agent
  // API's read path would drift, and "same boundary, different actor" would
  // quietly stop being true in the code.
  it('is the only layer that imports the Drizzle client or schema', () => {
    const offenders = ['app', 'components']
      .flatMap((d) => sourceFiles(d))
      .filter((file) => !file.startsWith(join('app', 'legacy-auth')))
      .filter((file) => {
        const code = stripComments(readFileSync(file, 'utf8'));
        // Importing TYPES from the schema is fine — components need Product,
        // Address, PaymentMethod. Importing the client is not.
        return /from\s+['"]@\/db\/client['"]/.test(code);
      });

    expect(offenders).toEqual([]);
  });
});

describe('payment details cannot be stored', () => {
  it('has no field anywhere that could hold a full card number', () => {
    const offenders = ['app', 'lib', 'components', 'db']
      .flatMap((d) => sourceFiles(d))
      .filter((file) => {
        const code = stripComments(readFileSync(file, 'utf8'));
        return /\b(cardNumber|card_number|fullNumber|full_number|cvv|cvc|securityCode|security_code)\b/i
          .test(code);
      });

    expect(offenders).toEqual([]);
  });
});
