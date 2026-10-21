import { getAgentSession } from '@/lib/auth/session-cookie';

/**
 * A thin bar above the nav, shown only when an AI assistant is signed in for a
 * customer rather than the customer themselves. Nothing marks that otherwise:
 * the storefront looks identical either way, which is the point of the graft and
 * also the reason someone looking at the screen deserves to be told.
 *
 * The address comes from the token, not from the session lookup, so it is the one
 * the assistant was actually admitted under.
 *
 * Ink bar with an ember eyebrow, per the palette note in globals.css: ember is an
 * eyebrow colour, and a full-width ember stripe on every page would spend it.
 */
export async function AgentBanner() {
  const session = await getAgentSession();
  if (!session) return null;

  return (
    <div className="bg-ink text-paper" role="status">
      <p className="mx-auto max-w-6xl px-6 py-2 text-[11px] font-medium uppercase tracking-[0.11em]">
        <span className="font-semibold text-ember">AI assistant</span>
        <span className="mx-2 text-paper/40" aria-hidden="true">
          ·
        </span>
        browsing on behalf of{' '}
        <span className="normal-case tracking-normal">{session.email}</span>
      </p>
    </div>
  );
}
