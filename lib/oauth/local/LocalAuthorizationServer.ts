import { SCOPES } from '../types';
import { OAuthError } from '../errors';
import * as clients from './clients';
import type {
  AuthorizationGrant, AuthorizationServer, AuthorizationServerMetadata,
  AuthorizeParams, ClientRegistrationRequest, CodeExchangeParams,
  IntrospectionResponse, PendingAuthorization, PublicClient, RefreshParams,
  RegisteredClient, TokenResponse,
} from '../server';

/**
 * Northbound's own authorization server. The default: no configuration, no
 * network, works offline.
 */
export class LocalAuthorizationServer implements AuthorizationServer {
  metadata(issuer: string): AuthorizationServerMetadata {
    return {
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      registration_endpoint: `${issuer}/oauth/register`,
      revocation_endpoint: `${issuer}/oauth/revoke`,
      introspection_endpoint: `${issuer}/oauth/introspect`,
      jwks_uri: `${issuer}/.well-known/jwks.json`,
      scopes_supported: SCOPES,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      // S256 only. `plain` is deliberately absent: a challenge that is its own
      // verifier proves nothing about the client that began the flow.
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: [
        'none', 'client_secret_basic', 'client_secret_post',
      ],
      authorization_details_types_supported: ['purchase'],
    };
  }

  registerClient(request: ClientRegistrationRequest): Promise<RegisteredClient> {
    return clients.registerClient(request);
  }

  getClient(clientId: string): Promise<PublicClient | null> {
    return clients.getClient(clientId);
  }

  authenticateClient(clientId: string, secret: string | null): Promise<PublicClient | null> {
    return clients.authenticateClient(clientId, secret);
  }

  // Implemented in the tasks that build the flows they belong to.
  createAuthorizationRequest(_params: AuthorizeParams): Promise<PendingAuthorization> {
    throw new OAuthError('server_error', 'authorization endpoint not yet implemented', 501);
  }

  getAuthorizationRequest(_requestId: string): Promise<PendingAuthorization | null> {
    throw new OAuthError('server_error', 'authorization endpoint not yet implemented', 501);
  }

  approveAuthorization(_requestId: string, _customerId: number): Promise<AuthorizationGrant> {
    throw new OAuthError('server_error', 'authorization endpoint not yet implemented', 501);
  }

  exchangeCode(_params: CodeExchangeParams): Promise<TokenResponse> {
    throw new OAuthError('server_error', 'token endpoint not yet implemented', 501);
  }

  refresh(_params: RefreshParams): Promise<TokenResponse> {
    throw new OAuthError('server_error', 'token endpoint not yet implemented', 501);
  }

  introspect(_token: string): Promise<IntrospectionResponse> {
    throw new OAuthError('server_error', 'introspection not yet implemented', 501);
  }

  revoke(_token: string): Promise<void> {
    throw new OAuthError('server_error', 'revocation not yet implemented', 501);
  }
}
