import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { withTestDb, type TestDb } from './harness';
import { browserContext } from '@/lib/oauth/types';

let tdb: TestDb;
let keyDir: string;

const ISSUER = 'https://shop.example';
const AGENT_ID = 'agent_shopping_assistant';

vi.mock('@/db/client', () => ({
  get db() {
    return (globalThis as { __testDb?: unknown }).__testDb;
  },
}));

beforeEach(async () => {
  vi.resetModules();
  keyDir = mkdtempSync(join(tmpdir(), 'nb-api-'));
  process.env.NORTHBOUND_KEY_FILE = join(keyDir, 'keys.json');

  tdb = await withTestDb();
  (globalThis as { __testDb?: unknown }).__testDb = tdb.db;
  const { seedAll } = await import('@/db/seed/index');
  await seedAll(tdb.db);
});

afterEach(async () => {
  await tdb.close();
  rmSync(keyDir, { recursive: true, force: true });
  delete process.env.NORTHBOUND_KEY_FILE;
});

/** Mints a token and records it, the way the CIBA exchange does. */
async function mintToken(options: {
  customerId?: number;
  scope?: string;
  issuer?: string;
  audience?: string;
  revoked?: boolean;
  expired?: boolean;
  agentId?: string | null;
} = {}) {
  const { signAccessToken } = await import('@/lib/oauth/jwt');
  const customerId = options.customerId ?? 82731;

  const { token, jti, expiresAt } = await signAccessToken(
    {
      customerId,
      agentId: options.agentId === undefined ? AGENT_ID : options.agentId,
      clientId: 'test-client',
      scope: options.scope ?? 'products:read orders:read cart:read cart:write checkout profile:read',
      authorizationDetails: [{
        type: 'purchase',
        max_amount: { value: '200.00', currency: 'USD' },
        merchant: 'northbound.example.com',
        period: 'P7D',
      }],
    },
    options.issuer ?? ISSUER,
  );

  await tdb.db.insert(schema.tokens).values({
    id: randomUUID(),
    kind: 'access',
    tokenHash: createHash('sha256').update(token).digest('hex'),
    jti,
    clientId: null,
    agentId: options.agentId === undefined ? AGENT_ID : options.agentId,
    customerId,
    scope: options.scope ?? 'products:read orders:read cart:read cart:write checkout profile:read',
    authorizationDetails: null,
    createdAt: new Date(),
    expiresAt: options.expired ? new Date(Date.now() - 1000) : expiresAt,
    revokedAt: options.revoked ? new Date() : null,
  });

  return token;
}

async function callOrders(headers: Record<string, string> = {}) {
  const { GET } = await import('@/app/api/orders/route');
  return GET(new Request(`${ISSUER}/api/orders`, { headers }));
}

describe('the challenge an unauthenticated request gets', () => {
  it('is 401 with a WWW-Authenticate pointing at the metadata', async () => {
    const response = await callOrders();

    expect(response.status).toBe(401);
    const challenge = response.headers.get('www-authenticate')!;
    expect(challenge).toMatch(/^Bearer /);
    expect(challenge).toContain('realm="Northbound"');
    expect(challenge).toContain(
      `resource_metadata="${ISSUER}/.well-known/oauth-protected-resource"`,
    );
  });

  it('points at the metadata for the host the request actually reached', async () => {
    const { GET } = await import('@/app/api/orders/route');
    const response = await GET(new Request('https://tunnel.ngrok.io/api/orders'));
    expect(response.headers.get('www-authenticate'))
      .toContain('resource_metadata="https://tunnel.ngrok.io/.well-known/oauth-protected-resource"');
  });
});

/**
 * THE HEADLINE REQUIREMENT.
 *
 * "Do not hand the agent a browser session." The API must never accept the
 * cookie that signs a human in, no matter how valid that cookie is.
 */
describe('the API never accepts a browser session', () => {
  it('rejects a request carrying a valid session cookie and no bearer token', async () => {
    const { createSession } = await import('@/lib/auth/session');
    const sessionToken = await createSession(82731);

    const response = await callOrders({ cookie: `nb_session=${sessionToken}` });

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('Bearer');
  });

  it('ignores the cookie entirely when a bearer token is also present', async () => {
    const { createSession } = await import('@/lib/auth/session');
    // Carol's session, Alice's token. The token must win.
    const carolSession = await createSession(44102);
    const aliceToken = await mintToken({ customerId: 82731 });

    const response = await callOrders({
      cookie: `nb_session=${carolSession}`,
      authorization: `Bearer ${aliceToken}`,
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    // Alice has seeded orders; Carol's would be a different set.
    expect(body.orders.every((o: { order_number: number }) => o.order_number >= 10225)).toBe(true);
    expect(body.acting_for).toBe('user_82731');
  });

  it('is structural: no API route can even reach the session helpers', () => {
    function walk(dir: string, out: string[] = []): string[] {
      if (!existsSync(dir)) return out;
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) walk(path, out);
        else if (/\.tsx?$/.test(path)) out.push(path);
      }
      return out;
    }

    const offenders = walk(join('app', 'api'))
      .filter((file) => /session-cookie|requireCustomer|getCurrentCustomer/
        .test(readFileSync(file, 'utf8')));

    expect(offenders).toEqual([]);
  });
});

describe('token validation', () => {
  it('rejects a token minted for a different audience', async () => {
    const token = await mintToken({ issuer: 'https://elsewhere.example' });
    expect((await callOrders({ authorization: `Bearer ${token}` })).status).toBe(401);
  });

  it('rejects an expired token', async () => {
    const { signAccessToken } = await import('@/lib/oauth/jwt');
    const { token } = await signAccessToken(
      { customerId: 82731, agentId: AGENT_ID, clientId: 'c', scope: 'orders:read' },
      ISSUER,
    );
    // Expire it by moving the clock past its 15 minutes.
    vi.setSystemTime(new Date(Date.now() + 16 * 60 * 1000));
    const response = await callOrders({ authorization: `Bearer ${token}` });
    vi.useRealTimers();

    expect(response.status).toBe(401);
  });

  // A signature stays valid after revocation. The fast path must consult the
  // record, or revoking a token would do nothing until it expired on its own.
  it('rejects a revoked token whose signature is still good', async () => {
    const token = await mintToken({ revoked: true });
    const response = await callOrders({ authorization: `Bearer ${token}` });

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('invalid_token');
  });

  it('rejects a token it never issued', async () => {
    const { signAccessToken } = await import('@/lib/oauth/jwt');
    const { token } = await signAccessToken(
      { customerId: 82731, agentId: AGENT_ID, clientId: 'c', scope: 'orders:read' },
      ISSUER,
    );
    // Signed correctly, but no issuance record exists.
    expect((await callOrders({ authorization: `Bearer ${token}` })).status).toBe(401);
  });

  it('rejects a malformed authorization header', async () => {
    for (const value of ['Bearer', 'Basic abc', 'Bearer  ', 'not-a-scheme token']) {
      expect((await callOrders({ authorization: value })).status, value).toBe(401);
    }
  });
});

describe('scopes', () => {
  it('refuses a token without the scope the route needs', async () => {
    const token = await mintToken({ scope: 'products:read' });
    const response = await callOrders({ authorization: `Bearer ${token}` });

    expect(response.status).toBe(403);
    const challenge = response.headers.get('www-authenticate')!;
    expect(challenge).toContain('insufficient_scope');
    expect(challenge).toContain('scope="orders:read"');
  });

  it('allows a token that has it', async () => {
    const token = await mintToken({ scope: 'orders:read' });
    expect((await callOrders({ authorization: `Bearer ${token}` })).status).toBe(200);
  });
});

describe('what the handler sees', () => {
  it('receives an ActorContext naming both identities', async () => {
    const token = await mintToken();
    const body = await (await callOrders({ authorization: `Bearer ${token}` })).json();

    expect(body.acting_for).toBe('user_82731');
    expect(body.actor).toBe(AGENT_ID);
  });

  // Ownership comes from the service layer, unchanged. The API inherits it.
  it('cannot read another customer\'s order', async () => {
    const { addToCart } = await import('@/lib/services/cart');
    const { placeOrder } = await import('@/lib/services/orders');
    const [address] = await tdb.db.select().from(schema.addresses)
      .where(eq(schema.addresses.customerId, 44102));
    const [card] = await tdb.db.select().from(schema.paymentMethods)
      .where(eq(schema.paymentMethods.customerId, 44102));
    const [product] = await tdb.db.select().from(schema.products).limit(1);

    await addToCart(browserContext(44102), product.id, 1);
    const carolOrder = await placeOrder(browserContext(44102), {
      addressId: address.id, paymentMethodId: card.id,
    });

    const aliceToken = await mintToken({ customerId: 82731 });
    const { GET } = await import('@/app/api/orders/[orderNumber]/route');
    const response = await GET(
      new Request(`${ISSUER}/api/orders/${carolOrder.orderNumber}`, {
        headers: { authorization: `Bearer ${aliceToken}` },
      }),
      { params: Promise.resolve({ orderNumber: String(carolOrder.orderNumber) }) },
    );

    expect(response.status).toBe(404);
  });
});
