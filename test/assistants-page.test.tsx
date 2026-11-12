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

/**
 * What a customer can actually read. The client ID is still in the markup as the anchor
 * an order's "by <name>" link lands on, and an attribute is not something anyone sees —
 * asserting over raw HTML would confuse "shown on the page" with "present in the file".
 */
function visibleText(html: string): string {
  return html.replace(/<[^>]*>/g, ' ');
}

beforeEach(() => { requireCustomer.mockReset(); listAssistants.mockReset(); });

describe('the assistants page', () => {
  it('leads with the name a customer would use, and drops the client id', async () => {
    const html = await render([assistant({ id: 'cli_muse', product: { name: 'Muse', domain: 'muse.ai' } })]);

    expect(visibleText(html)).toContain('Muse');
    // The id is what the token carries, not what a customer can judge. Beside a name it
    // is noise, so it is shown only when there is no name to show instead.
    expect(visibleText(html)).not.toContain('cli_muse');
  });

  it('shows the client id when it has no name for the client', async () => {
    const html = await render([assistant({ id: 'cli_opaque_9f2', product: null })]);

    expect(visibleText(html)).toContain('cli_opaque_9f2');
    // No invented name.
    expect(visibleText(html)).not.toContain('Muse');
  });

  it('distinguishes two assistants in one list', async () => {
    const html = await render([
      assistant({ id: 'cli_muse', product: { name: 'Muse', domain: 'muse.ai' } }),
      assistant({ id: 'cli_dots', product: { name: 'Dots', domain: 'openai.com' } }),
      assistant({ id: 'cli_mystery', product: null }),
    ]);

    for (const needle of ['Muse', 'Dots', 'cli_mystery']) {
      expect(html, `expected the page to show ${needle}`).toContain(needle);
    }
  });

  it('sends the order count to that assistant\'s orders, not to every order', async () => {
    const html = await render([assistant({ id: 'cli_muse', product: { name: 'Muse', domain: 'muse.ai' }, ordersPlaced: 2 })]);

    expect(html).toContain('2 orders placed');
    expect(html).toContain('/orders?agent=cli_muse');
  });

  it('says so plainly when no assistant has signed in', async () => {
    expect(await render([])).toContain('No AI assistant has signed in');
  });
});
