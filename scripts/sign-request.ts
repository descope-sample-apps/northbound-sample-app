/**
 * Signs an HTTP request with Web Bot Auth, so all three trust tiers are
 * demonstrable without a real agent platform.
 *
 *   pnpm agent:sign --tier trusted  --url http://localhost:3000/api/agent/authorize \
 *     --body '{"login_hint":"alice@example.com"}'
 *
 * --tier trusted  signs with a key published at a host on the trusted list
 * --tier unknown  signs with a key published at a host that is not
 * --tier none     emits the request unsigned
 *
 * Keys live in data/agent-keys/ (gitignored) and are generated on first use.
 * It prints a ready-to-run curl command and the JWKS the directory must serve.
 */
import { generateKeyPairSync, createPrivateKey } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { signRequest, exportPublicJwk } from '../lib/webbotauth/sign';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
}

const tier = args.get('tier') ?? 'trusted';
const url = args.get('url') ?? 'http://localhost:3000/api/agent/authorize';
const body = args.get('body') ?? JSON.stringify({ login_hint: 'alice@example.com' });

const DIRECTORIES: Record<string, string> = {
  trusted: 'http://localhost:4455/.well-known/http-message-signatures-directory',
  unknown: 'http://localhost:4456/.well-known/http-message-signatures-directory',
};

if (tier === 'none') {
  console.log(`curl -sS -X POST '${url}' \\\n  -H 'content-type: application/json' \\\n  -d '${body}'`);
  process.exit(0);
}

const directoryUrl = DIRECTORIES[tier];
if (!directoryUrl) {
  console.error(`unknown tier: ${tier}. Use trusted, unknown or none.`);
  process.exit(1);
}

mkdirSync('data/agent-keys', { recursive: true });
const keyPath = `data/agent-keys/${tier}.pem`;

if (!existsSync(keyPath)) {
  const { privateKey } = generateKeyPairSync('ed25519');
  writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  console.error(`# generated a new ${tier} agent key at ${keyPath}`);
}

const privateKey = createPrivateKey(readFileSync(keyPath, 'utf8'));

const request = await signRequest(
  new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body }),
  { privateKey, directoryUrl },
);

const { createPublicKey } = await import('node:crypto');
const jwks = { keys: [await exportPublicJwk(createPublicKey(privateKey))] };

console.error(`# serve this at ${directoryUrl}`);
console.error(JSON.stringify(jwks));
console.error('');

const headerArgs = [...request.headers.entries()]
  .map(([name, value]) => `  -H '${name}: ${value}' \\`)
  .join('\n');

console.log(`curl -sS -X POST '${url}' \\\n${headerArgs}\n  -d '${body}'`);
