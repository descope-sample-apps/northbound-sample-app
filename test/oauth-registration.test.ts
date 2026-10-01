import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
  vi.resetModules();
  tdb = await withTestDb();
  (globalThis as { __testDb?: unknown }).__testDb = tdb.db;
  const { seedAll } = await import('@/db/seed/index');
  await seedAll(tdb.db);
});

afterEach(async () => {
  await tdb.close();
  delete process.env.DESCOPE_PROJECT_ID;
});

const VALID = {
  client_name: 'Shopping Assistant',
  redirect_uris: ['https://assistant.example/callback'],
  grant_types: ['authorization_code', 'refresh_token'],
  token_endpoint_auth_method: 'none' as const,
  scope: 'products:read cart:write checkout',
};

async function as() {
  const { getAuthorizationServer } = await import('@/lib/oauth/server');
  return getAuthorizationServer();
}

describe('dynamic client registration (RFC 7591)', () => {
  it('issues a client_id and echoes the registered metadata back', async () => {
    const registered = await (await as()).registerClient(VALID);

    expect(registered.client_id).toMatch(/^nbc_[0-9a-f]{24}$/);
    expect(registered.client_id_issued_at).toBeTypeOf('number');
    expect(registered.client_name).toBe('Shopping Assistant');
    expect(registered.redirect_uris).toEqual(['https://assistant.example/callback']);
    expect(registered.grant_types).toEqual(['authorization_code', 'refresh_token']);
  });

  it('warns, in the response, that registration is open', async () => {
    const registered = await (await as()).registerClient(VALID);
    expect(String(registered.demo_notice)).toMatch(/open|demo/i);
  });

  it('returns a secret exactly once for a confidential client, and stores only its hash',
    async () => {
      const registered = await (await as()).registerClient({
        ...VALID, token_endpoint_auth_method: 'client_secret_basic',
      });

      expect(registered.client_secret).toBeTypeOf('string');
      expect(registered.client_secret!.length).toBeGreaterThan(20);

      const [row] = await tdb.db.select().from(schema.oauthClients)
        .where(eq(schema.oauthClients.clientId, registered.client_id));
      expect(row.clientSecretHash).toBeTruthy();
      expect(row.clientSecretHash).not.toBe(registered.client_secret);

      // getClient must never hand the secret back out.
      const fetched = await (await as()).getClient(registered.client_id);
      expect(fetched).not.toHaveProperty('client_secret');
    });

  it('issues no secret for a public client', async () => {
    const registered = await (await as()).registerClient(VALID);
    expect(registered.client_secret).toBeUndefined();
  });

  it('rejects a registration with no redirect_uris', async () => {
    await expect((await as()).registerClient({ ...VALID, redirect_uris: [] }))
      .rejects.toThrow(/redirect/i);
  });

  // Anti-open-redirect, first half. The second half is exact matching at
  // authorize time.
  it('rejects a non-https redirect URI unless it is loopback', async () => {
    const server = await as();

    for (const uri of [
      'http://assistant.example/cb',
      'ftp://assistant.example/cb',
      'javascript:alert(1)',
      '/relative/cb',
      'not a url',
    ]) {
      await expect(
        server.registerClient({ ...VALID, redirect_uris: [uri] }),
        uri,
      ).rejects.toThrow();
    }
  });

  it('allows http on loopback, because CLI agents redirect there', async () => {
    const server = await as();
    for (const uri of ['http://localhost:7788/callback', 'http://127.0.0.1:7788/callback']) {
      const registered = await server.registerClient({ ...VALID, redirect_uris: [uri] });
      expect(registered.redirect_uris, uri).toEqual([uri]);
    }
  });

  it('rejects a scope this resource does not define', async () => {
    await expect((await as()).registerClient({ ...VALID, scope: 'products:read wat:write' }))
      .rejects.toThrow(/scope/i);
  });

  it('creates an agent for a client that does not name a known one', async () => {
    const registered = await (await as()).registerClient(VALID);
    const [client] = await tdb.db.select().from(schema.oauthClients)
      .where(eq(schema.oauthClients.clientId, registered.client_id));

    const [agent] = await tdb.db.select().from(schema.agents)
      .where(eq(schema.agents.id, client.agentId));

    // Every client resolves to an identifiable actor, so no token can ever be
    // issued with an anonymous act claim.
    expect(agent).toBeTruthy();
    expect(agent.displayName).toBe('Shopping Assistant');
  });

  it('links to a known agent when one is named', async () => {
    const registered = await (await as()).registerClient({
      ...VALID, agent_id: 'agent_shopping_assistant',
    });
    const [client] = await tdb.db.select().from(schema.oauthClients)
      .where(eq(schema.oauthClients.clientId, registered.client_id));

    expect(client.agentId).toBe('agent_shopping_assistant');
    expect(await tdb.db.select().from(schema.agents)).toHaveLength(2);
  });

  it('returns null for an unknown client rather than throwing', async () => {
    expect(await (await as()).getClient('nbc_nope')).toBeNull();
  });
});

describe('the Descope seam', () => {
  it('selects the Descope implementation when DESCOPE_PROJECT_ID is set', async () => {
    process.env.DESCOPE_PROJECT_ID = 'P2abc';
    const server = await as();
    expect(server.constructor.name).toBe('DescopeAuthorizationServer');
  });

  it('is a stub whose every method says what a real implementation would call',
    async () => {
      process.env.DESCOPE_PROJECT_ID = 'P2abc';
      const server = await as();

      await expect(server.registerClient(VALID)).rejects.toThrow(/Descope/i);
      await expect(server.getClient('x')).rejects.toThrow(/Descope/i);
      await expect(server.exchangeCode({} as never)).rejects.toThrow(/Descope/i);
    });

  it('falls back to the local implementation when unset', async () => {
    const server = await as();
    expect(server.constructor.name).toBe('LocalAuthorizationServer');
  });
});
