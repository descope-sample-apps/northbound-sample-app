import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { browserContext } from '@/lib/oauth/types';

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
// not see lib/auth/ — the very directory where the credential code lives. A
// guard with a blind spot over the thing it guards is worse than no guard,
// because it reports green.
const STOREFRONT_DIRS = ['app', 'lib', 'components'];

/**
 * Sub-project B adds an authorization server, so OAuth vocabulary now exists in
 * the repository — on purpose, in four places and nowhere else.
 *
 * This allowlist is written out rather than the test being deleted or softened,
 * because what the test proves is the parent project's whole thesis: the
 * STOREFRONT stayed clean, and agent support arrived as an addition rather than
 * a rewrite. Losing that evidence would cost more than the test is worth
 * keeping.
 *
 * Adding an entry here is a deliberate act. If a storefront page ever needs to
 * be listed, that is the finding, not the fix.
 */
/**
 * Pages a HUMAN sees that are nonetheless part of the agent boundary: the
 * consent screen, the approval screen, the agent sign-in page. They are
 * storefront-shaped but they are not the shop.
 */
const AGENT_FACING_PAGES = [
  join('app', 'oauth'),     // consent screen
  join('app', 'agents'),    // the agent sign-in page
  join('app', 'approve'),   // CIBA approval screen
];

/** Machinery with no human-facing page in it at all. */
const MACHINE_SURFACES = [
  join('lib', 'oauth'),        // the authorization server
  join('lib', 'webbotauth'),   // RFC 9421 verification and the tier policy
  join('lib', 'agents'),       // agent identity resolution
  join('app', 'api'),          // the resource server and the authorize endpoint
  join('app', '.well-known'),  // discovery documents
  join('app', 'auth.md'),      // prose instructions for agents
  join('app', 'agents.md'),    // the same, under the other convention
];

const OAUTH_DIRS = [...AGENT_FACING_PAGES, ...MACHINE_SURFACES];

const isOauthSurface = (file: string) =>
  OAUTH_DIRS.some((dir) => file.startsWith(dir + sep));

/** The one module the spec permits to reach the legacy credential store. */
const LEGACY_ROUTE = join('app', 'legacy-auth', 'verify', 'route.ts');

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
      if (isOauthSurface(file)) continue;

      const code = stripComments(readFileSync(file, 'utf8'));
      const matches = code.match(
        /\b(bearer|access_token|refresh_token|authorization_details|policyEngine|OAuthError|AuthorizationServer)\b/g,
      );
      if (matches) offenders.push(`${file}: ${[...new Set(matches)].join(', ')}`);
    }

    expect(offenders).toEqual([]);
  });

  // ActorContext is deliberately NOT in the list above any more.
  //
  // Until the agent-support commit it was scaffolding, and finding it in the
  // service layer would have meant the storefront was built in anticipation of
  // agents. Now it is the application's own vocabulary — the type that makes
  // "who is this for" and "who is doing it" separate questions everywhere.
  //
  // What replaces that assertion is narrower and more useful: storefront code
  // may PASS a context, but must never CONSTRUCT an actor. Only the bearer
  // guard, which has a verified token in hand, gets to say an agent is present.
  it('never lets storefront code claim an actor', () => {
    const offenders = STOREFRONT_DIRS
      .flatMap((d) => sourceFiles(d))
      .filter((file) => !isOauthSurface(file))
      .filter((file) => /actor:\s*\{/.test(stripComments(readFileSync(file, 'utf8'))));

    expect(offenders).toEqual([]);
  });

  it('builds every storefront context through browserContext', () => {
    // browserContext hardcodes actor: null, so a page cannot accidentally
    // inherit an agent identity from a request it is handling.
    expect(browserContext(82731)).toMatchObject({
      customerId: 82731, actor: null, scopes: [], source: 'browser',
    });
  });

  // Storefront code may import the shared vocabulary — ActorContext and
  // browserContext — and nothing else from lib/oauth. Importing the
  // authorization server, the token signer or the client registry into a page
  // is the leak this guards against; the word "oauth" in an import path is not.
  it('imports only the shared vocabulary from lib/oauth', () => {
    const offenders: string[] = [];

    for (const file of STOREFRONT_DIRS.flatMap((d) => sourceFiles(d))) {
      if (isOauthSurface(file)) continue;

      const code = stripComments(readFileSync(file, 'utf8'));
      for (const match of code.matchAll(/from\s+['"]@\/lib\/oauth\/([\w/.-]+)['"]/g)) {
        if (match[1] !== 'types') offenders.push(`${file}: @/lib/oauth/${match[1]}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  // The allowlist above is only trustworthy if it stays narrow. A storefront
  // page appearing in it would mean OAuth had leaked into the shop.
  it('keeps every shop page out of the agent surfaces', () => {
    // A page may be on the agent boundary (consent, approval, /agents) or it
    // may be a shop page. If a shop page ever appeared inside a machine
    // surface, OAuth would have leaked into the storefront.
    const pagesInMachineSurfaces = sourceFiles('app')
      .filter((file) => /page\.tsx$/.test(file))
      .filter((file) => MACHINE_SURFACES.some((dir) => file.startsWith(dir + sep)));

    expect(pagesInMachineSurfaces).toEqual([]);
  });

  it('keeps the agent-facing page list short and deliberate', () => {
    // Three screens: consent, approval, and the agent sign-in page. Growth here
    // should be a decision somebody made, not something that happened.
    expect(AGENT_FACING_PAGES).toHaveLength(3);
  });

  it('exposes exactly one non-OAuth HTTP route, and it is not under /api', () => {
    const routes = sourceFiles('app')
      .filter((f) => /route\.tsx?$/.test(f))
      .filter((f) => !isOauthSurface(f));

    expect(routes).toEqual([LEGACY_ROUTE]);
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
