import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Customer } from '@/db/schema';

/**
 * THE BEHAVIOUR A CUSTOMER NOTICES. Descope's External Authentication action sends them
 * to /login to prove who they are. Someone already signed in to Northbound has nothing
 * left to prove, so the page must finish the request and send them straight back to the
 * flow — not show them a sign-in form they would have to fill in a second time.
 *
 * test/external-auth.test.ts covers the other half, where they arrive signed out and
 * loginAction completes the request after they sign in. Nothing covered this half, and
 * it is the half an approval flow runs into most.
 */
const getHumanCustomer = vi.fn();
const getCurrentCustomer = vi.fn();
const completeExternalAuth = vi.fn();

// redirect() throws in Next so nothing renders after it. Throwing here reproduces that,
// and the message is what the assertions read.
const redirect = vi.fn((url: string) => { throw new Error(`NEXT_REDIRECT ${url}`); });

vi.mock('@/db/client', () => ({ db: {}, sqlite: {} }));
vi.mock('next/navigation', () => ({ redirect }));
vi.mock('@/lib/auth/session-cookie', () => ({ getHumanCustomer, getCurrentCustomer }));
vi.mock('@/lib/agentSession/externalAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/agentSession/externalAuth')>()),
  completeExternalAuth,
}));

const LoginPage = (await import('@/app/login/page')).default;

const alice = { id: 7, email: 'alice@example.com', name: 'Alice' } as unknown as Customer;
const FLOW = 'https://auth.northbound.camp/v1/flow/continue?x=1';

async function visit(params: Record<string, string | string[] | undefined>) {
  return renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve(params) }));
}

beforeEach(() => {
  getHumanCustomer.mockReset();
  getCurrentCustomer.mockReset();
  completeExternalAuth.mockReset();
  redirect.mockClear();
  getHumanCustomer.mockResolvedValue(null);
  getCurrentCustomer.mockResolvedValue(null);
  completeExternalAuth.mockResolvedValue(FLOW);
});

describe('External Authentication for a customer who is already signed in', () => {
  it('finishes the request and returns to the flow without showing a sign-in form', async () => {
    getHumanCustomer.mockResolvedValue(alice);

    await expect(visit({ external_auth_req_id: 'req_abc123' })).rejects.toThrow(`NEXT_REDIRECT ${FLOW}`);
    expect(completeExternalAuth).toHaveBeenCalledWith('req_abc123', alice.id);
  });

  it('shows the form, carrying the request, when nobody is signed in', async () => {
    const html = await visit({ external_auth_req_id: 'req_abc123' });

    expect(completeExternalAuth).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
    // The request has to survive the sign-in, or loginAction has nothing to complete.
    expect(html).toContain('req_abc123');
  });

  /**
   * An agent holding a DS cookie is NOT the customer. Completing the request on its
   * behalf would let an agent approve its own access, which is the one thing the
   * approval step exists to prevent — so this reads the human session, never
   * getCurrentCustomer, and an agent sees the form like anyone else.
   */
  it('does not treat an agent session as the customer', async () => {
    getHumanCustomer.mockResolvedValue(null);
    getCurrentCustomer.mockResolvedValue(alice);

    const html = await visit({ external_auth_req_id: 'req_abc123' });

    expect(completeExternalAuth).not.toHaveBeenCalled();
    expect(html).toContain('Sign in');
  });

  it('ignores a malformed request id rather than acting on it', async () => {
    // Both, because the real getCurrentCustomer falls back to the human session; mocking
    // them apart would describe a state that cannot happen.
    getHumanCustomer.mockResolvedValue(alice);
    getCurrentCustomer.mockResolvedValue(alice);

    // Not a request id, so the page is an ordinary login page — and an ordinary login
    // page sends a customer who is already signed in home.
    await expect(visit({ external_auth_req_id: 'not a request id' })).rejects.toThrow('NEXT_REDIRECT /');
    expect(completeExternalAuth).not.toHaveBeenCalled();
  });
});
