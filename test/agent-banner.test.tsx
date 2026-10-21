import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Customer } from '@/db/schema';

const getAgentSession = vi.fn();
vi.mock('@/lib/auth/session-cookie', () => ({ getAgentSession }));

const { AgentBanner } = await import('@/components/brand/AgentBanner');

const alice = {
  id: 1,
  email: 'alice@example.com',
  name: 'Alice Nguyen',
  emailVerified: true,
  passwordHash: null,
  authBackend: 'local',
  signupOrigin: 'web',
  passwordSetAt: null,
} as unknown as Customer;

/** Renders the async server component the way the layout does. */
async function render() {
  return renderToStaticMarkup(await AgentBanner());
}

beforeEach(() => { getAgentSession.mockReset(); });

describe('AgentBanner', () => {
  // A customer here themselves must see the store exactly as it was. The banner
  // appearing for a person would be a lie about who is driving.
  it('renders nothing when no assistant is signed in', async () => {
    getAgentSession.mockResolvedValue(null);
    expect(await render()).toBe('');
  });

  it('names the customer the assistant is acting for', async () => {
    getAgentSession.mockResolvedValue({ customer: alice, agent: 'agt_abc', email: alice.email, scopes: [] });

    const html = await render();
    expect(html).toContain('alice@example.com');
    expect(html).toContain('browsing on behalf of');
    expect(html).toContain('AI assistant');
  });

  // The token's address, not the matched customer row's: they differ in case,
  // and the banner should say what the assistant was admitted under.
  it('shows the address from the token, not the customer record', async () => {
    getAgentSession.mockResolvedValue({
      customer: alice,
      agent: 'agt_abc',
      email: 'Alice@Example.com',
      scopes: [],
    });

    expect(await render()).toContain('Alice@Example.com');
  });

  it('is an ink bar with ember kept to the eyebrow, per the palette note', async () => {
    getAgentSession.mockResolvedValue({ customer: alice, agent: 'agt_abc', email: alice.email, scopes: [] });

    const html = await render();
    expect(html).toContain('bg-ink');
    expect(html).toContain('text-ember');
    expect(html).not.toContain('bg-ember');
  });

  it('escapes an address rather than letting it carry markup', async () => {
    getAgentSession.mockResolvedValue({
      customer: alice,
      agent: 'agt_abc',
      email: '<script>alert(1)</script>@example.com',
      scopes: [],
    });

    const html = await render();
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
