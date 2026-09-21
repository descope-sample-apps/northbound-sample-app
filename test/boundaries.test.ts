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

const STOREFRONT_DIRS = ['app', 'lib/services', 'components'];

describe('sub-project A contains no agent concepts', () => {
  // The thesis of this project is that agent access is GRAFTED ONTO a retailer
  // that already exists. If the storefront ships with agent scaffolding baked
  // in, sub-project B's diff stops demonstrating that and instead demonstrates
  // code we wrote in anticipation of ourselves. This test is what keeps the
  // claim true as the repository grows.
  it('uses no OAuth, agent, scope or policy vocabulary in storefront code', () => {
    const offenders: string[] = [];

    for (const file of STOREFRONT_DIRS.flatMap((d) => sourceFiles(d))) {
      if (file.startsWith(join('app', 'legacy-auth'))) continue;

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
  it('is imported by exactly one module', () => {
    const importers = STOREFRONT_DIRS
      .flatMap((d) => sourceFiles(d))
      .filter((file) => /schema\/legacy/.test(readFileSync(file, 'utf8')));

    expect(importers).toEqual([join('app', 'legacy-auth', 'verify', 'route.ts')]);
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
