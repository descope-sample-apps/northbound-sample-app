import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { withTestDb, type TestDb } from './harness';

let tdb: TestDb;

vi.mock('@/db/client', () => ({
  get db() {
    return (globalThis as { __testDb?: unknown }).__testDb;
  },
}));

beforeEach(async () => {
  tdb = await withTestDb();
  (globalThis as { __testDb?: unknown }).__testDb = tdb.db;
});

afterEach(async () => { await tdb.close(); });

describe('oauth schema', () => {
  it('exports every OAuth table', () => {
    for (const table of [
      'agents', 'oauthClients', 'authorizationRequests', 'authorizationCodes', 'tokens',
    ]) {
      expect(schema, table).toHaveProperty(table);
    }
  });

  // A database read must not hand somebody a working credential. Codes,
  // tokens and client secrets are all stored hashed, never in the clear.
  it('stores no credential in the clear', () => {
    const source = readFileSync('db/schema/oauth.ts', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    expect(source).toMatch(/codeHash/);
    expect(source).toMatch(/tokenHash/);
    expect(source).toMatch(/clientSecretHash/);

    // No column that would hold the raw value beside the hash.
    expect(source).not.toMatch(/\btoken:\s*text\('token'\)/);
    expect(source).not.toMatch(/\bcode:\s*text\('code'\)/);
    expect(source).not.toMatch(/clientSecret:\s*text\('client_secret'\)/);
  });

  it('makes token and code hashes unique', async () => {
    const now = new Date();
    await tdb.db.insert(schema.agents).values({
      id: 'agent_x', displayName: 'X', owner: 'O', createdAt: now,
    });
    await tdb.db.insert(schema.oauthClients).values({
      clientId: 'c1', agentId: 'agent_x', clientName: 'X',
      redirectUris: '["https://x.example/cb"]',
      grantTypes: '["authorization_code"]',
      tokenEndpointAuthMethod: 'none', createdAt: now,
    });
    await tdb.db.insert(schema.tokens).values({
      id: 't1', kind: 'access', tokenHash: 'dup', jti: 'j1',
      clientId: 'c1', agentId: 'agent_x', customerId: null,
      scope: '', createdAt: now, expiresAt: now,
    });

    await expect(tdb.db.insert(schema.tokens).values({
      id: 't2', kind: 'access', tokenHash: 'dup', jti: 'j2',
      clientId: 'c1', agentId: 'agent_x', customerId: null,
      scope: '', createdAt: now, expiresAt: now,
    })).rejects.toThrow();
  });
});

describe('seeded agents', () => {
  beforeEach(async () => {
    const { seedAll } = await import('@/db/seed/index');
    await seedAll(tdb.db);
  });

  it('creates the two demo agents', async () => {
    const rows = await tdb.db.select().from(schema.agents);
    expect(rows).toHaveLength(2);
    expect(rows.map((a) => a.id).sort())
      .toEqual(['agent_pantry_bot', 'agent_shopping_assistant']);
  });

  it('gives the shopping assistant a display name and an owner', async () => {
    const [agent] = await tdb.db.select().from(schema.agents)
      .where(eq(schema.agents.id, 'agent_shopping_assistant'));
    expect(agent.displayName).toBe('Shopping Assistant');
    expect(agent.owner.length).toBeGreaterThan(0);
  });

  it('does not create any customer-like row for an agent', async () => {
    // The parent spec is explicit: no agent_user table, no parallel accounts.
    // An agent acts FOR a customer that already existed.
    const customers = await tdb.db.select().from(schema.customers);
    expect(customers).toHaveLength(3);
    expect(customers.map((c) => c.email))
      .toEqual(expect.arrayContaining([
        'alice@example.com', 'bob@example.com', 'carol@example.com',
      ]));
  });

  it('stays idempotent — re-seeding clears the OAuth tables too', async () => {
    const now = new Date();
    await tdb.db.insert(schema.oauthClients).values({
      clientId: 'leftover', agentId: 'agent_pantry_bot', clientName: 'Leftover',
      redirectUris: '[]', grantTypes: '[]', tokenEndpointAuthMethod: 'none',
      createdAt: now,
    });

    const { seedAll } = await import('@/db/seed/index');
    await seedAll(tdb.db);

    expect(await tdb.db.select().from(schema.oauthClients)).toHaveLength(0);
    expect(await tdb.db.select().from(schema.agents)).toHaveLength(2);
    expect(await tdb.db.select().from(schema.customers)).toHaveLength(3);
  });
});
