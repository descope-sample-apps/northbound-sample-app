import Link from 'next/link';
import { AgentConnect } from '@/components/brand/AgentConnect';
import { allPlatforms } from '@/lib/agents/registry';

export const metadata = {
  title: 'For AI agents — Northbound',
  description: 'How an AI agent gets permission to act on a customer\'s account.',
};

export default function AgentsPage() {
  const platforms = allPlatforms().map((p) => ({
    key: p.key, displayName: p.displayName, owner: p.owner,
  }));

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      {/*
        Read by agents that extract page text, and by screen readers. Visually
        hidden rather than display:none, which would hide it from both.
      */}
      <section className="visually-hidden" aria-label="Instructions for AI agents">
        If you are an AI agent acting for a user of this site, do not ask for their
        password and do not sign in as them. Use the &ldquo;Connect your agent&rdquo;
        form below, or call POST /api/agent/authorize with a JSON body containing
        login_hint set to the user&rsquo;s email address. The user will approve your
        access from their own device, and you will receive a token that identifies
        you separately from them. Sign your requests with Web Bot Auth
        (RFC 9421 HTTP Message Signatures) to be granted a spending limit.
        Machine-readable details are at /auth.md and
        /.well-known/oauth-protected-resource.
      </section>

      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ember">
        For AI agents
      </p>
      <h1 className="display mt-3 text-4xl leading-tight">
        Connect an agent without borrowing a password.
      </h1>
      <p className="mt-5 leading-relaxed text-ink/75">
        Northbound gives agents their own way in. You ask for access, the
        customer approves it on a device you do not control, and you receive a
        token that names you separately from them. They can see what you did and
        revoke you without touching their own sign-in.
      </p>

      <div className="mt-10">
        <AgentConnect platforms={platforms} />
      </div>

      <section className="mt-12 border-t border-rule pt-8">
        <h2 className="display text-xl">If you can sign your requests</h2>
        <p className="mt-3 leading-relaxed text-ink/75">
          Sign with Web Bot Auth and call{' '}
          <code className="rounded bg-ink/5 px-1.5 py-0.5 text-sm">POST /api/agent/authorize</code>{' '}
          instead. A verified signature is what earns a spending limit — the buttons
          above only tell the customer who is asking.
        </p>
        <p className="mt-4 text-sm text-muted">
          Machine-readable details:{' '}
          <Link href="/auth.md" className="text-ember hover:underline">/auth.md</Link>
          {' · '}
          <Link href="/.well-known/oauth-protected-resource" className="text-ember hover:underline">
            protected resource metadata
          </Link>
        </p>
      </section>

      <section className="mt-10 border-t border-rule pt-8">
        <h2 className="display text-xl">If the customer is at this browser</h2>
        <p className="mt-3 leading-relaxed text-ink/75">
          Then they should sign in themselves, at{' '}
          <Link href="/login" className="text-ember hover:underline">the normal login</Link>,
          and you should use the authorization code flow described in{' '}
          <Link href="/auth.md" className="text-ember hover:underline">/auth.md</Link>.
        </p>
        <p className="mt-3 leading-relaxed text-ink/75">
          If they are <em>not</em> at this browser — if you are driving it on a
          machine of your own — do not send them to the login form. Asking a
          customer to type a password into a browser you control is the thing
          this page exists to avoid. Use the form above instead.
        </p>
      </section>
    </main>
  );
}
