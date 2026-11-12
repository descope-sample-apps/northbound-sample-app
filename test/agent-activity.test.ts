import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { generateKeyPair, exportJWK, SignJWT, type CryptoKey as JoseKey } from 'jose';
import { existsSync, readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { withTestDb, seedMinimal, type TestDb } from './harness';
import { addresses, knownAgents, orders, paymentMethods } from '@/db/schema';

let tdb: TestDb;

vi.mock('@/db/client', () => ({
  get db() {
    return (globalThis as { __testDb?: unknown }).__testDb;
  },
}));

const DISCOVERY = 'https://api.descope.test/v1/apps/P1/.well-known/openid-configuration';
const ISSUER = 'https://api.descope.test/v1/apps/P1';
const JWKS = 'https://api.descope.test/P1/.well-known/jwks.json';
const ALICE = 82731;

let signingKey: JoseKey;
const realFetch = globalThis.fetch;

beforeEach(async () => {
  tdb = await withTestDb();
  await seedMinimal(tdb);
  (globalThis as { __testDb?: unknown }).__testDb = tdb.db;
  process.env.DESCOPE_DISCOVERY_URL = DISCOVERY;

  const pair = await generateKeyPair('RS256');
  signingKey = pair.privateKey;
  const publicJwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === DISCOVERY) return Response.json({ issuer: ISSUER, jwks_uri: JWKS });
    if (url === JWKS) return Response.json({ keys: [publicJwk] });
    return new Response(null, { status: 404 });
  }) as typeof fetch;

  const { resetAgentSessionCache } = await import('@/lib/agentSession/descope');
  resetAgentSessionCache();
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  delete process.env.DESCOPE_DISCOVERY_URL;
  await tdb.close();
});

function token(opts: { agent?: string; scope?: string } = {}) {
  return new SignJWT({
    email: 'alice@example.com',
    act: { sub: opts.agent ?? 'agt_abc' },
    scope: opts.scope ?? 'orders:read',
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(ISSUER)
    .setSubject('U123')
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(signingKey);
}

describe('recording which assistants have acted', () => {
  it('records an assistant the first time its token is accepted', async () => {
    const { resolveAgentToken } = await import('@/lib/agentSession/descope');

    await resolveAgentToken(await token());

    const rows = await tdb.db.select().from(knownAgents);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ customerId: ALICE, agentId: 'agt_abc', scope: 'orders:read' });
  });

  // The point of the unique constraint: a list of assistants, not a request log.
  it('keeps one row per assistant however many requests it makes', async () => {
    const { resolveAgentToken } = await import('@/lib/agentSession/descope');

    await resolveAgentToken(await token());
    await resolveAgentToken(await token());
    await resolveAgentToken(await token({ agent: 'agt_other' }));

    const rows = await tdb.db.select().from(knownAgents);
    expect(rows.map((r) => r.agentId).sort()).toEqual(['agt_abc', 'agt_other']);
  });

  it('keeps the first approval date and moves the last-seen date', async () => {
    const { recordAgentVisit } = await import('@/lib/agentSession/knownAgents');

    await recordAgentVisit(ALICE, 'agt_abc', ['orders:read']);
    const [first] = await tdb.db.select().from(knownAgents);

    await new Promise((r) => setTimeout(r, 1100));
    await recordAgentVisit(ALICE, 'agt_abc', ['orders:read', 'orders:write']);
    const [second] = await tdb.db.select().from(knownAgents);

    expect(second.firstSeenAt).toEqual(first.firstSeenAt);
    expect(second.lastSeenAt.getTime()).toBeGreaterThan(first.lastSeenAt.getTime());
    // What it can do now, not what it could do when it was approved.
    expect(second.scope).toBe('orders:read orders:write');
  });

  // A forged token must not let anyone write into a customer's list of assistants.
  it('records nothing for a token it rejects', async () => {
    const { resolveAgentToken } = await import('@/lib/agentSession/descope');

    await resolveAgentToken(await token({ scope: 'profile:read' })); // no Northbound scope
    await resolveAgentToken('not-a-token');

    expect(await tdb.db.select().from(knownAgents)).toEqual([]);
  });

  // Availability over completeness, as the module documents.
  it('signs the assistant in even when the record cannot be written', async () => {
    const { recordAgentVisit } = await import('@/lib/agentSession/knownAgents');
    await tdb.sqlite.execute('DROP TABLE known_agents');

    await expect(recordAgentVisit(ALICE, 'agt_abc', ['orders:read'])).resolves.toBeUndefined();
  });
});

describe('what the customer is shown', () => {
  it('describes each permission in words, not scope names', async () => {
    const { listAssistants } = await import('@/lib/agentSession/knownAgents');
    const { recordAgentVisit } = await import('@/lib/agentSession/knownAgents');

    await recordAgentVisit(ALICE, 'agt_abc', ['orders:read', 'orders:write']);

    const [assistant] = await listAssistants(ALICE);
    expect(assistant.allowed).toEqual([
      'See your orders and what you have in your cart',
      'Place an order with your saved address and card',
    ]);
  });

  // Nothing granted is hidden, even if this build has no wording for it.
  it('shows an unrecognized permission as itself', async () => {
    const { listAssistants, recordAgentVisit } = await import('@/lib/agentSession/knownAgents');

    await recordAgentVisit(ALICE, 'agt_abc', ['orders:read', 'something:new']);

    expect((await listAssistants(ALICE))[0].allowed).toContain('something:new');
  });

  it('counts only the orders that assistant placed for that customer', async () => {
    const { listAssistants, recordAgentVisit } = await import('@/lib/agentSession/knownAgents');
    const now = new Date();
    const [address] = await tdb.db.select().from(addresses).where(eq(addresses.customerId, ALICE));
    const [card] = await tdb.db.select().from(paymentMethods).where(eq(paymentMethods.customerId, ALICE));

    await recordAgentVisit(ALICE, 'agt_abc', ['orders:write']);
    const order = (orderNumber: number, placedByAgent: string | null) => ({
      customerId: ALICE, orderNumber, status: 'placed' as const,
      subtotalCents: 100, shippingCents: 0, taxCents: 0, totalCents: 100,
      shippingAddressId: address.id, paymentMethodId: card.id, placedAt: now, placedByAgent,
    });
    await tdb.db.insert(orders).values([
      order(1001, 'agt_abc'),
      order(1002, 'agt_other'),
      order(1003, null),
    ]);

    expect((await listAssistants(ALICE))[0].ordersPlaced).toBe(1);
  });

  it('shows one customer nothing about another customer', async () => {
    const { listAssistants, recordAgentVisit } = await import('@/lib/agentSession/knownAgents');

    await recordAgentVisit(ALICE, 'agt_abc', ['orders:read']);

    expect(await listAssistants(19382)).toEqual([]);
  });

  it('puts the most recently active assistant first', async () => {
    const { listAssistants, recordAgentVisit } = await import('@/lib/agentSession/knownAgents');

    await recordAgentVisit(ALICE, 'agt_old', ['orders:read']);
    await new Promise((r) => setTimeout(r, 1100));
    await recordAgentVisit(ALICE, 'agt_new', ['orders:read']);

    expect((await listAssistants(ALICE)).map((a) => a.id)).toEqual(['agt_new', 'agt_old']);
  });

  // act.sub is the OAuth client ID, so the list can say which product is acting.
  it('names the product behind a client ID the store knows', async () => {
    const { listAssistants, recordAgentVisit } = await import('@/lib/agentSession/knownAgents');
    const { resetAgentProductCache } = await import('@/lib/agentSession/agentProducts');
    process.env.AGENT_CLIENTS = JSON.stringify({ agt_abc: { name: 'Muse', domain: 'muse.ai' } });
    resetAgentProductCache();

    await recordAgentVisit(ALICE, 'agt_abc', ['orders:read']);
    await recordAgentVisit(ALICE, 'agt_unknown', ['orders:read']);

    const byId = Object.fromEntries((await listAssistants(ALICE)).map((a) => [a.id, a.product]));
    expect(byId.agt_abc).toEqual({ name: 'Muse', domain: 'muse.ai' });
    // Shown as a third-party agent rather than guessed at.
    expect(byId.agt_unknown).toBeNull();

    delete process.env.AGENT_CLIENTS;
    resetAgentProductCache();
  });

  it('says nothing when no assistant has ever signed in', async () => {
    const { listAssistants } = await import('@/lib/agentSession/knownAgents');

    expect(await listAssistants(ALICE)).toEqual([]);
  });
});

describe('the wording matches what the discovery document publishes', () => {
  // The store should not describe a permission one way to a Personal Agent and
  // another way to the customer it belongs to.
  //
  // The discovery document is not on this branch — it is a separate PR — so this
  // skips rather than asserting against a file that isn't here. It starts enforcing
  // the moment that document lands, which is the moment the two can disagree.
  const ROUTE = 'app/.well-known/poppy.json/route.ts';

  it.skipIf(!existsSync(ROUTE))('uses the same sentences as poppy.json auth.scopes', async () => {
    const { scopeDescriptions } = await import('@/lib/agentSession/knownAgents');
    const route = readFileSync(ROUTE, 'utf8');

    for (const [scope, sentence] of Object.entries(scopeDescriptions)) {
      expect(route, `poppy.json should describe ${scope} the same way`).toContain(sentence);
    }
  });
});
