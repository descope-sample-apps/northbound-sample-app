import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Customer } from '@/db/schema';
import type { Assistant } from '@/lib/agentSession/knownAgents';

const requireCustomer = vi.fn();
const listAssistants = vi.fn();
vi.mock('@/lib/auth/session-cookie', () => ({ requireCustomer }));
vi.mock('@/lib/agentSession/knownAgents', () => ({ listAssistants }));

const AssistantsPage = (await import('@/app/account/assistants/page')).default;

const alice = { id: 1, email: 'alice@example.com', name: 'Alice' } as unknown as Customer;

const assistant = (over: Partial<Assistant>): Assistant => ({
  id: 'cli_opaque_9f2',
  product: null,
  firstSeenAt: new Date('2026-10-26T12:00:00Z'),
  lastSeenAt: new Date('2026-11-07T19:33:00Z'),
  allowed: ['See your orders and what you have in your cart'],
  ordersPlaced: 0,
  ...over,
});

async function render(list: Assistant[]) {
  requireCustomer.mockResolvedValue(alice);
  listAssistants.mockResolvedValue(list);
  return renderToStaticMarkup(await AssistantsPage());
}

beforeEach(() => { requireCustomer.mockReset(); listAssistants.mockReset(); });

describe('the assistants page', () => {
  it('names a product the store knows, and leads with who operates it', async () => {
    const html = await render([assistant({ id: 'cli_muse', product: { name: 'Muse', domain: 'muse.ai' } })]);

    expect(html).toContain('Muse');
    expect(html).toContain('muse.ai');
    // The client id stays visible: it is what a customer matches against Descope.
    expect(html).toContain('cli_muse');
  });

  it('calls an unrecognized client a third-party agent and shows its id', async () => {
    const html = await render([assistant({ id: 'cli_opaque_9f2', product: null })]);

    expect(html).toContain('Third-party agent');
    expect(html).toContain('cli_opaque_9f2');
    // No invented name.
    expect(html).not.toContain('Muse');
  });

  it('distinguishes two assistants in one list', async () => {
    const html = await render([
      assistant({ id: 'cli_muse', product: { name: 'Muse', domain: 'muse.ai' } }),
      assistant({ id: 'cli_dots', product: { name: 'Dots', domain: 'openai.com' } }),
      assistant({ id: 'cli_mystery', product: null }),
    ]);

    for (const needle of ['Muse', 'muse.ai', 'Dots', 'openai.com', 'Third-party agent', 'cli_mystery']) {
      expect(html, `expected the page to show ${needle}`).toContain(needle);
    }
  });

  it('says so plainly when no assistant has signed in', async () => {
    expect(await render([])).toContain('No AI assistant has signed in');
  });
});
