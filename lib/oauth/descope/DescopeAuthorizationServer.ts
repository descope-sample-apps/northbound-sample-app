import { SCOPES } from '../types';
import type {
  AuthorizationGrant, AuthorizationServer, AuthorizationServerMetadata,
  AuthorizeParams, ClientRegistrationRequest, CodeExchangeParams,
  IntrospectionResponse, PendingAuthorization, PublicClient, RefreshParams,
  RegisteredClient, TokenResponse,
} from '../server';

/**
 * A DELIBERATE STUB. Selected when DESCOPE_PROJECT_ID is set.
 *
 * It exists so the AuthorizationServer seam is real rather than asserted: if
 * the only implementation were the local one, nothing would stop authorization
 * logic leaking into route handlers, and the claim that this application could
 * delegate to a hosted authorization server would be untested architecture.
 *
 * Every method below names the Descope API a real implementation would call.
 * None of them pretend to work — a stub that silently returned something
 * plausible would be worse than one that refuses.
 */
function notImplemented(method: string, descopeApi: string): never {
  throw new Error(
    `DescopeAuthorizationServer.${method}() is a stub. `
    + `TODO: call the Descope ${descopeApi} API for project `
    + `${process.env.DESCOPE_PROJECT_ID}. Unset DESCOPE_PROJECT_ID to use the `
    + `local authorization server.`,
  );
}

export class DescopeAuthorizationServer implements AuthorizationServer {
  metadata(issuer: string): AuthorizationServerMetadata {
    // The one method that can answer honestly: a hosted AS publishes its own
    // metadata, and a real implementation would proxy or redirect to it.
    const base = `https://api.descope.com/${process.env.DESCOPE_PROJECT_ID}`;
    return {
      issuer: base,
      authorization_endpoint: `${base}/oauth2/v1/authorize`,
      token_endpoint: `${base}/oauth2/v1/token`,
      registration_endpoint: `${base}/oauth2/v1/register`,
      revocation_endpoint: `${base}/oauth2/v1/revoke`,
      introspection_endpoint: `${base}/oauth2/v1/introspect`,
      jwks_uri: `${base}/.well-known/jwks.json`,
      scopes_supported: SCOPES,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_basic'],
      authorization_details_types_supported: ['checkout'],
    };
  }

  async registerClient(_r: ClientRegistrationRequest): Promise<RegisteredClient> {
    return notImplemented('registerClient', 'Inbound Apps / client registration');
  }

  async getClient(_clientId: string): Promise<PublicClient | null> {
    return notImplemented('getClient', 'Inbound Apps client lookup');
  }

  async authenticateClient(_id: string, _s: string | null): Promise<PublicClient | null> {
    return notImplemented('authenticateClient', 'Inbound Apps client authentication');
  }

  async createAuthorizationRequest(_p: AuthorizeParams): Promise<PendingAuthorization> {
    return notImplemented('createAuthorizationRequest', 'OAuth 2.1 authorize');
  }

  async getAuthorizationRequest(_id: string): Promise<PendingAuthorization | null> {
    return notImplemented('getAuthorizationRequest', 'OAuth 2.1 authorize');
  }

  async approveAuthorization(_id: string, _c: number): Promise<AuthorizationGrant> {
    return notImplemented('approveAuthorization', 'consent');
  }

  async exchangeCode(_p: CodeExchangeParams): Promise<TokenResponse> {
    return notImplemented('exchangeCode', 'OAuth 2.1 token');
  }

  async refresh(_p: RefreshParams): Promise<TokenResponse> {
    return notImplemented('refresh', 'OAuth 2.1 token (refresh_token grant)');
  }

  async introspect(_token: string): Promise<IntrospectionResponse> {
    return notImplemented('introspect', 'token introspection');
  }

  async revoke(_token: string): Promise<void> {
    return notImplemented('revoke', 'token revocation');
  }
}
