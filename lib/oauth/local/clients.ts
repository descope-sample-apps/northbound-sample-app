import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { agents, oauthClients } from '@/db/schema';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { SCOPES, isScope } from '../types';
import { OAuthError } from '../errors';
import type {
  ClientRegistrationRequest, PublicClient, RegisteredClient,
} from '../server';

export const DEMO_NOTICE =
  'Registration on this server is OPEN: any caller may register a client without '
  + 'a software statement or prior approval. That is correct for a reference '
  + 'implementation an arbitrary agent is meant to be able to drive, and wrong '
  + 'for production.';

/**
 * Redirect URIs must be absolute https, with one exception.
 *
 * CLI agents cannot receive an https callback, so http on loopback is allowed —
 * the narrowest carve-out that keeps a command-line agent usable. Everything
 * else is rejected here, and then matched character-for-character at authorize
 * time. Both halves are needed: this one keeps garbage out of the database, and
 * exact matching is what actually prevents an open redirect.
 */
function assertValidRedirectUri(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OAuthError('invalid_request', `redirect_uri is not a URL: ${value}`);
  }

  const isLoopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';

  if (url.protocol === 'https:') return;
  if (url.protocol === 'http:' && isLoopback) return;

  throw new OAuthError(
    'invalid_request',
    `redirect_uri must use https, or http on loopback: ${value}`,
  );
}

const RegistrationSchema = z.object({
  client_name: z.string().trim().min(1, 'client_name is required').max(120),
  redirect_uris: z.array(z.string()).min(1, 'at least one redirect_uri is required'),
  grant_types: z.array(z.string()).default(['authorization_code', 'refresh_token']),
  token_endpoint_auth_method: z
    .enum(['none', 'client_secret_basic', 'client_secret_post'])
    .default('none'),
  scope: z.string().optional(),
  logo_uri: z.string().url().optional(),
  agent_id: z.string().optional(),
});

function newClientId(): string {
  return `nbc_${randomBytes(12).toString('hex')}`;
}

export async function registerClient(
  raw: ClientRegistrationRequest,
): Promise<RegisteredClient> {
  const parsed = RegistrationSchema.safeParse(raw);
  if (!parsed.success) {
    throw new OAuthError('invalid_request', parsed.error.issues[0].message);
  }
  const request = parsed.data;

  for (const uri of request.redirect_uris) assertValidRedirectUri(uri);

  if (request.scope) {
    const unknown = request.scope.split(/\s+/).filter(Boolean).filter((s) => !isScope(s));
    if (unknown.length > 0) {
      throw new OAuthError(
        'invalid_scope',
        `unknown scope: ${unknown.join(', ')}. Supported: ${SCOPES.join(' ')}`,
      );
    }
  }

  const now = new Date();

  // Every client resolves to an identifiable agent, so no token can ever carry
  // an anonymous `act` claim. A registration that names a known agent links to
  // it; one that does not gets an agent created from its own client_name.
  let agentId = request.agent_id ?? null;

  if (agentId) {
    const [existing] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
    if (!existing) throw new OAuthError('invalid_request', `unknown agent_id: ${agentId}`);
  } else {
    agentId = `agent_${randomBytes(8).toString('hex')}`;
    await db.insert(agents).values({
      id: agentId,
      displayName: request.client_name,
      owner: 'Dynamically registered',
      description: 'Registered through RFC 7591 dynamic client registration.',
      createdAt: now,
    });
  }

  const isConfidential = request.token_endpoint_auth_method !== 'none';
  const clientSecret = isConfidential ? randomBytes(32).toString('base64url') : undefined;

  const clientId = newClientId();

  await db.insert(oauthClients).values({
    clientId,
    // Reuses the customer-password scrypt helper rather than introducing a
    // second hashing scheme for the same job.
    clientSecretHash: clientSecret ? await hashPassword(clientSecret) : null,
    agentId,
    clientName: request.client_name,
    logoUri: request.logo_uri ?? null,
    redirectUris: JSON.stringify(request.redirect_uris),
    grantTypes: JSON.stringify(request.grant_types),
    tokenEndpointAuthMethod: request.token_endpoint_auth_method,
    scope: request.scope ?? null,
    createdAt: now,
  });

  return {
    client_id: clientId,
    client_secret: clientSecret,
    client_id_issued_at: Math.floor(now.getTime() / 1000),
    client_name: request.client_name,
    redirect_uris: request.redirect_uris,
    grant_types: request.grant_types,
    token_endpoint_auth_method: request.token_endpoint_auth_method,
    scope: request.scope,
    logo_uri: request.logo_uri,
    agent_id: agentId,
    demo_notice: DEMO_NOTICE,
  };
}

/** Never returns the secret — only whether one exists. */
export async function getClient(clientId: string): Promise<PublicClient | null> {
  const [row] = await db.select().from(oauthClients)
    .where(eq(oauthClients.clientId, clientId)).limit(1);
  if (!row) return null;

  return {
    clientId: row.clientId,
    clientName: row.clientName,
    agentId: row.agentId,
    redirectUris: JSON.parse(row.redirectUris) as string[],
    grantTypes: JSON.parse(row.grantTypes) as string[],
    tokenEndpointAuthMethod: row.tokenEndpointAuthMethod,
    scope: row.scope,
    logoUri: row.logoUri,
    isConfidential: row.clientSecretHash !== null,
  };
}

export async function authenticateClient(
  clientId: string,
  clientSecret: string | null,
): Promise<PublicClient | null> {
  const [row] = await db.select().from(oauthClients)
    .where(eq(oauthClients.clientId, clientId)).limit(1);
  if (!row) return null;

  // A public client authenticates by knowing its client_id and by PKCE; a
  // confidential one must present its secret.
  if (row.clientSecretHash === null) return getClient(clientId);
  if (!clientSecret) return null;
  if (!(await verifyPassword(clientSecret, row.clientSecretHash))) return null;

  return getClient(clientId);
}
