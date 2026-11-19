import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { withTestDb, seedMinimal, type TestDb } from './harness';

/**
 * Why a token was turned away, told to the agent instead of only the log.
 *
 * The API answers every bad token with one sentence on purpose: the detail that explains
 * a refusal to an operator — which claim disagreed, which customer was looked for — tells
 * whoever holds a forged token exactly what to change. That is the right default and it
 * stays the default.
 *
 * It is the wrong behaviour in a demo. An agent that signs in, gets refused, re-signs in
 * and loops has no way to learn that the email on the token has no account here, and
 * neither does whoever is watching it. AGENT_DEBUG_REFUSALS trades the secrecy for that
 * answer, deliberately and per deployment.
 */

const ORIGIN = 'https://northbound.camp';
let tdb: TestDb;

const inspectAgentToken = vi.fn();

vi.mock('@/db/client', () => ({
  get db() {
    return (globalThis as { __testDb?: unknown }).__testDb;
  },
}));

vi.mock('@/lib/agentSession/descope', () => ({
  inspectAgentToken: (token: string) => inspectAgentToken(token),
  resolveAgentToken: async (token: string) => (await inspectAgentToken(token)).session,
  descopeIssuer: async () => 'https://auth.northbound.camp/v1/apps/P1',
}));

beforeEach(async () => {
  tdb = await withTestDb();
  await seedMinimal(tdb);
  (globalThis as { __testDb?: unknown }).__testDb = tdb.db;
  inspectAgentToken.mockReset();
  inspectAgentToken.mockResolvedValue({
    session: null,
    reason: 'no Northbound customer with that email',
  });
  delete process.env.AGENT_DEBUG_REFUSALS;
});

afterEach(async () => {
  await tdb.close();
  delete process.env.AGENT_DEBUG_REFUSALS;
});

async function refusal() {
  const { GET } = await import('@/app/api/agent/v1/orders/route');
  const res = await GET(
    new Request(`${ORIGIN}/api/agent/v1/orders`, {
      headers: { authorization: 'Bearer some-token' },
    }),
    undefined,
  );
  return { res, body: await res.json(), challenge: res.headers.get('www-authenticate') ?? '' };
}

describe('refusing a token with the flag off', () => {
  it('says nothing about which guard turned it away', async () => {
    const { res, body, challenge } = await refusal();

    expect(res.status).toBe(401);
    expect(body.error).toBe('invalid_token');
    expect(body.error_description).toBe('The access token is not valid for Northbound.');
    expect(body.error_description).not.toContain('customer');
    expect(challenge).not.toContain('customer');
  });

  it('stays off for any value that is not exactly true', async () => {
    for (const value of ['1', 'yes', 'TRUE', 'true ', '']) {
      process.env.AGENT_DEBUG_REFUSALS = value;
      const { body } = await refusal();

      expect(body.error_description).toBe('The access token is not valid for Northbound.');
    }
  });

  it('is off when the variable is absent', async () => {
    delete process.env.AGENT_DEBUG_REFUSALS;

    expect((await refusal()).body.error_description)
      .toBe('The access token is not valid for Northbound.');
  });
});

describe('refusing a token with the flag on', () => {
  beforeEach(() => {
    process.env.AGENT_DEBUG_REFUSALS = 'true';
  });

  it('names the guard that turned it away', async () => {
    const { res, body } = await refusal();

    expect(res.status).toBe(401);
    expect(body.error).toBe('invalid_token');
    expect(body.error_description).toContain('no Northbound customer with that email');
  });

  it('puts it in the challenge too, where a client already looks', async () => {
    expect((await refusal()).challenge).toContain('no Northbound customer with that email');
  });

  it('carries whatever the resolver said, not a fixed list', async () => {
    inspectAgentToken.mockResolvedValue({
      session: null,
      reason: 'token carries neither orders:read nor orders:write',
    });

    expect((await refusal()).body.error_description)
      .toContain('token carries neither orders:read nor orders:write');
  });

  it('still answers 401 and still refuses', async () => {
    // The flag explains a refusal; it never turns one into an acceptance.
    const { res } = await refusal();

    expect(res.status).toBe(401);
  });

  // A reason is whatever went wrong, including a stringified error. Database failures
  // arrive as multi-line strings — one was observed reading
  // `Failed query: select ...\nparams: alice@example.com,1`. That reason is about to be
  // written into a response header, where a newline is header injection: undici refuses
  // the value and the route 500s instead of answering 401. So the reason is flattened
  // before it goes anywhere near a header.
  it('survives a reason with newlines and quotes in it', async () => {
    inspectAgentToken.mockResolvedValue({
      session: null,
      reason: 'Failed query: select "id"\nparams: alice@example.com,1\r\nX-Injected: yes',
    });

    const { res, body, challenge } = await refusal();

    expect(res.status).toBe(401);
    expect(challenge).not.toMatch(/[\r\n]/);
    expect(res.headers.get('x-injected')).toBeNull();
    expect(body.error_description).toContain('Failed query');
  });

  // A header value is a ByteString, so anything above U+00FF throws exactly as a newline
  // does. Reasons quote real data — a customer's name, the email on the token — so an
  // accent or a non-Latin script reaching one is ordinary, not exotic.
  it('survives a reason carrying characters a header cannot hold', async () => {
    inspectAgentToken.mockResolvedValue({
      session: null,
      reason: 'no Northbound customer with that email: zoë@café.example — 日本語',
    });

    const { res, challenge } = await refusal();

    expect(res.status).toBe(401);
    expect(challenge).toContain('no Northbound customer with that email');
  });

  it('does not let a very long reason run away with the header', async () => {
    inspectAgentToken.mockResolvedValue({ session: null, reason: 'x'.repeat(5000) });

    const { res, challenge } = await refusal();

    expect(res.status).toBe(401);
    expect(challenge.length).toBeLessThan(600);
  });

  it('does not describe a request that simply had no token', async () => {
    const { GET } = await import('@/app/api/agent/v1/orders/route');

    const res = await GET(new Request(`${ORIGIN}/api/agent/v1/orders`), undefined);
    const body = await res.json();

    // Nothing was presented, so there is no guard to name and nothing to leak. The
    // standing message mentions a customer approving a token, which is not a reason.
    expect(res.status).toBe(401);
    expect(body.error).toBe('unauthorized');
    expect(body.error_description).not.toContain('no Northbound customer with that email');
  });
});
