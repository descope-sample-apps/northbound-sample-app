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
 * THE GRAFT. Agent access arrives through Agent Edge's Cloudflare Worker and front
 * door, which hand the agent's browser a Descope token in a cookie. Everything else
 * an agent needs happens at the edge, so all of Northbound's agent code is token
 * validation, and it lives in this one directory.
 */
const AGENT_DIR = join('lib', 'agentSession');

/** The only storefront files that import the agent code: the session lookup, checkout's step-up, and login's External Authentication. */
const AGENT_AWARE_FILES = [
  join('app', 'checkout', 'actions.ts'),
  join('app', 'login', 'actions.ts'),
  join('app', 'login', 'page.tsx'),
  join('lib', 'auth', 'session-cookie.ts'),
].sort();

describe('the Agent Edge graft stays contained', () => {
  it('is referenced only from the files listed in AGENT_AWARE_FILES', () => {
    const users = STOREFRONT_DIRS.flatMap((d) => sourceFiles(d))
      .filter((file) => !file.startsWith(AGENT_DIR))
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
      if (file.startsWith(AGENT_DIR)) continue;

      const code = stripComments(readFileSync(file, 'utf8'));
      const matches = code.match(
        /\b(oauth|bearer|access_token|refresh_token|ActorContext|authorization_details|scopes?|policyEngine)\b/gi,
      );
      if (matches) offenders.push(`${file}: ${[...new Set(matches)].join(', ')}`);
    }

    expect(offenders).toEqual([]);
  });

  it('exposes exactly one HTTP route, and it is not under /api', () => {
    const routes = sourceFiles('app').filter((f) => /route\.tsx?$/.test(f));
    expect(routes).toEqual([join('app', 'legacy-auth', 'verify', 'route.ts')]);
    expect(existsSync(join('app', 'api'))).toBe(false);
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
