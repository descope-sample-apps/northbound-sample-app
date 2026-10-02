import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { withTestDb, type TestDb } from './harness';

let tdb: TestDb;
let keyDir: string;
let agentKeys: { publicKey: KeyObject; privateKey: KeyObject };
let otherKeys: { publicKey: KeyObject; privateKey: KeyObject };
let directories: Map<string, unknown>;

// A directory registered in config/agent-platforms.json, so this agent is
// verified-trusted and earns the blog's $200 cap.
const DIRECTORY = 'https://agents.muse.example/.well-known/http-message-signatures-directory';
const ISSUER = 'https://shop.example';

vi.mock('@/db/client', () => ({
  get db() {
    return (globalThis as { __testDb?: unknown }).__testDb;
  },
}));

beforeEach(async () => {
  vi.resetModules();
  keyDir = mkdtempSync(join(tmpdir(), 'nb-ciba-'));
  process.env.NORTHBOUND_KEY_FILE = join(keyDir, 'keys.json');

  agentKeys = generateKeyPairSync('ed25519');
  otherKeys = generateKeyPairSync('ed25519');

  directories = new Map();
  vi.stubGlobal('fetch', async (input: string | URL) => {
    const key = String(input);
    if (!directories.has(key)) return new Response('nope', { status: 404 });
    return new Response(JSON.stringify(directories.get(key)), { status: 200 });
  });

  tdb = await withTestDb();
  (globalThis as { __testDb?: unknown }).__testDb = tdb.db;
  const { seedAll } = await import('@/db/seed/index');
  await seedAll(tdb.db);

  const { exportPublicJwk } = await import('@/lib/webbotauth/sign');
  directories.set(DIRECTORY, { keys: [await exportPublicJwk(agentKeys.publicKey)] });
});

afterEach(async () => {
  await tdb.close();
  rmSync(keyDir, { recursive: true, force: true });
  delete process.env.NORTHBOUND_KEY_FILE;
  vi.unstubAllGlobals();
});

async function signed(body: unknown, privateKey = agentKeys.privateKey) {
  const { signRequest } = await import('@/lib/webbotauth/sign');
  return signRequest(
    new Request('https://shop.example/api/agent/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { privateKey, directoryUrl: DIRECTORY },
  );
}

/** Starts a verified request and returns its auth_req_id. */
async function startVerified(loginHint = 'alice@example.com') {
  const { signRequest } = await import('@/lib/webbotauth/sign');
  const request = await signRequest(
    new Request('https://shop.example/api/agent/authorize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ login_hint: loginHint }),
    }),
    { privateKey: agentKeys.privateKey, directoryUrl: DIRECTORY },
  );

  const { startAgentAuthorization } = await import('@/lib/agents/startAuthorization');
  const { start, identity } = await startAgentAuthorization({
    request, loginHint, issuer: ISSUER,
  });
  return { authReqId: start.auth_req_id, identity };
}

async function approve(authReqId: string, customerId = 82731) {
  const { decideBackchannelRequest } = await import('@/lib/oauth/local/ciba');
  return decideBackchannelRequest(authReqId, customerId, 'approved');
}

async function poll(authReqId: string, privateKey = agentKeys.privateKey) {
  const { POST } = await import('@/app/api/agent/token/route');
  return POST(await signed({ auth_req_id: authReqId }, privateKey));
}

describe('polling before a decision', () => {
  it('returns authorization_pending', async () => {
    const { authReqId } = await startVerified();
    const response = await poll(authReqId);

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('authorization_pending');
  });

  it('returns slow_down when polled faster than the interval', async () => {
    const { authReqId } = await startVerified();
    await poll(authReqId);
    const second = await poll(authReqId);

    expect((await second.json()).error).toBe('slow_down');
  });

  it('returns access_denied after the customer declines', async () => {
    const { authReqId } = await startVerified();
    const { decideBackchannelRequest } = await import('@/lib/oauth/local/ciba');
    await decideBackchannelRequest(authReqId, 82731, 'denied');

    expect((await (await poll(authReqId)).json()).error).toBe('access_denied');
  });

  it('returns expired_token once the window has passed', async () => {
    const { authReqId } = await startVerified();
    await tdb.db.update(schema.backchannelRequests)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.backchannelRequests.id, authReqId));

    expect((await (await poll(authReqId)).json()).error).toBe('expired_token');
  });

  it('returns invalid_grant for an auth_req_id nobody issued', async () => {
    expect((await (await poll('made-up-id')).json()).error).toBe('invalid_grant');
  });

  // A login_hint that matched no customer produces a row that can never be
  // approved — indistinguishable from one the customer is ignoring.
  it('never completes for an address that matched nobody', async () => {
    const { authReqId } = await startVerified('stranger@example.com');
    await approve(authReqId, 82731);
    expect((await (await poll(authReqId)).json()).error).toBe('authorization_pending');
  });
});

describe('the token an approved request produces', () => {
  it('names both identities and carries the approved grant', async () => {
    const { authReqId } = await startVerified();
    await approve(authReqId);

    const response = await poll(authReqId);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.token_type).toBe('Bearer');
    expect(body.expires_in).toBe(900);
    expect(body.refresh_token).toBeTruthy();

    const { verifyAccessTokenSignature } = await import('@/lib/oauth/jwt');
    const claims = await verifyAccessTokenSignature(
      body.access_token, ISSUER, `${ISSUER}/api`,
    );

    expect(claims.sub).toBe('user_82731');
    expect(claims.act?.sub).toBeTruthy();
    expect(claims.scope).toContain('checkout');
    expect(claims.authorization_details?.[0]).toMatchObject({
      type: 'purchase',
      max_amount: { value: '200.00', currency: 'USD' },
      period: 'P7D',
    });
  });

  it('records the issuance so the token can be revoked later', async () => {
    const { authReqId } = await startVerified();
    await approve(authReqId);
    await poll(authReqId);

    const rows = await tdb.db.select().from(schema.tokens);
    expect(rows.filter((t) => t.kind === 'access')).toHaveLength(1);
    expect(rows.filter((t) => t.kind === 'refresh')).toHaveLength(1);
    // Hashed, never stored in the clear.
    expect(rows[0].tokenHash).not.toContain('.');
  });

  it('creates a durable agent row, so activity can be attributed and revoked', async () => {
    const { authReqId } = await startVerified();
    await approve(authReqId);
    await poll(authReqId);

    const [token] = await tdb.db.select().from(schema.tokens)
      .where(eq(schema.tokens.kind, 'access'));
    expect(token.agentId).toBeTruthy();

    const [agent] = await tdb.db.select().from(schema.agents)
      .where(eq(schema.agents.id, token.agentId!));
    expect(agent).toBeTruthy();
  });

  it('is issued exactly once — a second poll does not mint another', async () => {
    const { authReqId } = await startVerified();
    await approve(authReqId);

    const first = await poll(authReqId);
    expect(first.status).toBe(200);

    const second = await poll(authReqId);
    expect(second.status).toBe(400);
    expect((await second.json()).error).toBe('invalid_grant');
  });
});

// auth_req_id alone must not be enough. Without this, anyone who observed it
// could collect a token the customer approved for somebody else.
describe('the token is bound to the agent that asked', () => {
  it('refuses a poll signed by a different key', async () => {
    const { exportPublicJwk } = await import('@/lib/webbotauth/sign');
    directories.set(DIRECTORY, {
      keys: [
        await exportPublicJwk(agentKeys.publicKey),
        await exportPublicJwk(otherKeys.publicKey),
      ],
    });

    const { authReqId } = await startVerified();
    await approve(authReqId);

    const response = await poll(authReqId, otherKeys.privateKey);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('invalid_grant');
  });

  it('refuses an unsigned poll for a request that was signed', async () => {
    const { authReqId } = await startVerified();
    await approve(authReqId);

    const { POST } = await import('@/app/api/agent/token/route');
    const response = await POST(new Request('https://shop.example/api/agent/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ auth_req_id: authReqId }),
    }));

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('invalid_grant');
  });
});
