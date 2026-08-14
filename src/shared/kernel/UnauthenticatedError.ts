import { DomainError } from './DomainError.js';

/**
 * Thrown when a protected route is reached with NO resolved `AuthContext` —
 * a missing, expired, malformed, or revoked Bearer token all land here:
 * `authContextMiddleware` attaches nothing when the resolver returns `null`,
 * so `requireAuthContext` finds the request bare. This is a request-time
 * 401, NOT a wiring bug — the middleware always runs, it just resolved
 * nothing. Lives in `shared/kernel` (same rationale as `AuthScopeError`:
 * `shared` may not depend on any module) and maps via ONE `UNAUTHENTICATED`
 * entry in `errorStatus.ts`.
 */
export class UnauthenticatedError extends DomainError {
  constructor(message = 'authentication required') {
    super('UNAUTHENTICATED', message);
  }
}
