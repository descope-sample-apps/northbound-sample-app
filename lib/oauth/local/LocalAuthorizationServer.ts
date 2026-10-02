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
    // ADVERTISE ONLY WHAT EXISTS.
    //
    // An earlier version listed authorization_endpoint, token_endpoint,
    // revocation_endpoint and introspection_endpoint under /oauth/*, none of
    // which were built — so an agent following the discovery chain, which is
    // precisely the behaviour this metadata exists to enable, would have walked
    // into four 404s. Metadata that lies is worse than metadata that is sparse:
    // a missing field makes a client choose another path, a wrong one makes it
    // fail in a way it cannot diagnose.
    //
    // RFC 8414 lists authorization_endpoint as required only for grant types
    // that use it. CIBA does not, so omitting it is correct rather than a gap.
    return {
      issuer,
      registration_endpoint: `${issuer}/oauth/register`,
      jwks_uri: `${issuer}/.well-known/jwks.json`,

      // The backchannel pair. Northbound starts the request and the agent polls
      // the same host, so these are Northbound's own endpoints rather than a
      // separate authorization server's — which is what it means for Northbound
      // to be the OAuth client in this flow.
      backchannel_authentication_endpoint: `${issuer}/api/agent/authorize`,
      backchannel_token_delivery_modes_supported: ['poll'],
      token_endpoint: `${issuer}/api/agent/token`,

      scopes_supported: SCOPES,
      grant_types_supported: ['urn:openid:params:grant-type:ciba'],
      token_endpoint_auth_methods_supported: ['none'],
      authorization_details_types_supported: ['purchase'],

      // Northbound's own extensions, named so they are not mistaken for
      // RFC 8414 fields. Signing is what earns a spending limit, and an agent
      // should be able to discover that rather than having to read prose.
      signed_request_methods_supported: ['web-bot-auth'],
      agent_instructions_uri: `${issuer}/auth.md`,
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
