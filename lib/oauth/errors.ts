/**
 * Errors that map onto an OAuth error response.
 *
 * Kept in their own module so the implementations can import them without
 * creating a runtime cycle back to server.ts, which imports the
 * implementations.
 */
export type OAuthErrorCode =
  | 'invalid_request'
  | 'invalid_client'
  | 'invalid_grant'
  | 'unauthorized_client'
  | 'unsupported_grant_type'
  | 'invalid_scope'
  | 'access_denied'
  | 'server_error';

export class OAuthError extends Error {
  constructor(
    readonly code: OAuthErrorCode,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'OAuthError';
  }
}

/**
 * Raised when a request is bad in a way that must NOT be reported by
 * redirecting — an unknown client, or a redirect URI that is not registered.
 *
 * Redirecting an error to an unverified URI is the open-redirect bug itself,
 * so these render an error page instead.
 */
export class UnredirectableError extends OAuthError {
  constructor(message: string) {
    super('invalid_request', message, 400);
    this.name = 'UnredirectableError';
  }
}
