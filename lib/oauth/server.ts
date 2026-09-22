import type { AuthorizationDetail, Scope } from './types';
export { OAuthError, UnredirectableError } from './errors';
import { LocalAuthorizationServer } from './local/LocalAuthorizationServer';
import { DescopeAuthorizationServer } from './descope/DescopeAuthorizationServer';

/**
 * The authorization server, behind one interface.
 *
 * The parent specification is explicit that AS logic must not be scattered
 * through route handlers. Everything under app/oauth/ parses HTTP and delegates
 * here; nothing there makes an authorization decision of its own.
 *
 * Two implementations exist so the seam is real rather than asserted: swapping
 * Northbound's own authorization server for a hosted one must be a
 * configuration change, not a rewrite.
 */
export interface AuthorizationServer {
  metadata(issuer: string): AuthorizationServerMetadata;

  registerClient(request: ClientRegistrationRequest): Promise<RegisteredClient>;
  getClient(clientId: string): Promise<PublicClient | null>;
  authenticateClient(
    clientId: string,
    clientSecret: string | null,
  ): Promise<PublicClient | null>;

  createAuthorizationRequest(params: AuthorizeParams): Promise<PendingAuthorization>;
  getAuthorizationRequest(requestId: string): Promise<PendingAuthorization | null>;
  approveAuthorization(requestId: string, customerId: number): Promise<AuthorizationGrant>;

  exchangeCode(params: CodeExchangeParams): Promise<TokenResponse>;
  refresh(params: RefreshParams): Promise<TokenResponse>;

  introspect(token: string): Promise<IntrospectionResponse>;
  revoke(token: string): Promise<void>;
}

export type AuthorizationServerMetadata = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
  revocation_endpoint: string;
  introspection_endpoint: string;
  jwks_uri: string;
  scopes_supported: readonly string[];
  response_types_supported: string[];
  grant_types_supported: string[];
  code_challenge_methods_supported: string[];
  token_endpoint_auth_methods_supported: string[];
  authorization_details_types_supported: string[];
};

export type ClientRegistrationRequest = {
  client_name: string;
  redirect_uris: string[];
  grant_types?: string[];
  token_endpoint_auth_method?: 'none' | 'client_secret_basic' | 'client_secret_post';
  scope?: string;
  logo_uri?: string;
  /** Northbound extension: link this client to an already-registered agent. */
  agent_id?: string;
};

export type RegisteredClient = {
  client_id: string;
  /** Returned exactly once, at registration. Only the hash is stored. */
  client_secret?: string;
  client_id_issued_at: number;
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  token_endpoint_auth_method: string;
  scope?: string;
  logo_uri?: string;
  agent_id: string;
  demo_notice: string;
};

/** A client as everything downstream sees it. Never carries the secret. */
export type PublicClient = {
  clientId: string;
  clientName: string;
  agentId: string;
  redirectUris: string[];
  grantTypes: string[];
  tokenEndpointAuthMethod: string;
  scope: string | null;
  logoUri: string | null;
  isConfidential: boolean;
};

export type AuthorizeParams = {
  clientId: string;
  redirectUri: string;
  scope: string;
  state?: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  authorizationDetails?: unknown;
  resource?: string;
};

export type PendingAuthorization = {
  id: string;
  client: PublicClient;
  redirectUri: string;
  scopes: Scope[];
  state?: string;
  authorizationDetails: AuthorizationDetail[];
  expiresAt: Date;
};

export type AuthorizationGrant = { code: string; redirectUri: string; state?: string };

export type CodeExchangeParams = {
  code: string;
  clientId: string;
  clientSecret: string | null;
  redirectUri: string;
  codeVerifier: string | undefined;
  issuer: string;
};

export type RefreshParams = {
  refreshToken: string;
  clientId: string;
  clientSecret: string | null;
  issuer: string;
};

export type TokenResponse = {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
  authorization_details?: AuthorizationDetail[];
};

export type IntrospectionResponse =
  | { active: false }
  | {
      active: true;
      sub: string;
      act?: { sub: string };
      client_id: string;
      scope: string;
      token_type: 'Bearer';
      exp: number;
      iat: number;
      jti: string;
    };

let localInstance: AuthorizationServer | null = null;
let descopeInstance: AuthorizationServer | null = null;

/**
 * The only way to obtain an authorization server.
 *
 * Route handlers call this rather than constructing an implementation, so which
 * one is in use is a single decision made in a single place — and swapping
 * Northbound's own AS for a hosted one is a configuration change.
 *
 * The two implementations import only TYPES from this module, so the import
 * cycle is erased at build time.
 */
export function getAuthorizationServer(): AuthorizationServer {
  if (process.env.DESCOPE_PROJECT_ID) {
    descopeInstance ??= new DescopeAuthorizationServer();
    return descopeInstance;
  }

  localInstance ??= new LocalAuthorizationServer();
  return localInstance;
}
