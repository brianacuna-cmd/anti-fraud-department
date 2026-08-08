import { DomainError } from './DomainError.js';

/**
 * Thrown when a resolved `AuthContext.purpose` (design D3, two-step-login)
 * does not authorize the route being called — either `requireAuthContext`'s
 * default-deny (only `'full'` scope) or `requireScopedAuthContext`'s
 * explicit allow-list. Lives in `shared/kernel`, not `identity-access`
 * (design: `shared` may not depend on any module) — both `requestAuthContext`
 * (shared) and `requireScopedAuthContext` (identity-access/application) throw
 * this SAME class, so `identity-access`'s `errorHandler` maps it via ONE
 * `FORBIDDEN_AUTH_SCOPE` entry in `errorStatus.ts` regardless of which layer
 * raised it.
 */
export class AuthScopeError extends DomainError {
  constructor(message: string, metadata: Readonly<Record<string, unknown>> = {}) {
    super('FORBIDDEN_AUTH_SCOPE', message, metadata);
  }
}
