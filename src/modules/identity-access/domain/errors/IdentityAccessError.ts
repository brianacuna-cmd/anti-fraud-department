import { DomainError } from '../../../../shared/kernel/DomainError.js';
import type { IdentityAccessErrorCode } from './IdentityAccessErrorCode.js';

/**
 * The one concrete `DomainError` subtype for the whole `identity-access`
 * module (design D5). HTTP status mapping lives in the HTTP layer
 * (`infrastructure/adapters/inbound/http/errorStatus.ts`), never here.
 */
export class IdentityAccessError extends DomainError {
  constructor(
    code: IdentityAccessErrorCode,
    message: string,
    metadata: Readonly<Record<string, unknown>> = {},
  ) {
    super(code, message, metadata);
  }
}

export function invariantViolation(
  message: string,
  metadata: Readonly<Record<string, unknown>> = {},
): IdentityAccessError {
  return new IdentityAccessError('INVARIANT_VIOLATION', message, metadata);
}

export function invalidTransition(current: string, next: string): IdentityAccessError {
  return new IdentityAccessError(
    'INVALID_TRANSITION',
    `cannot transition from "${current}" to "${next}"`,
    { current, next },
  );
}

export function forbiddenReactivation(current: string, next: string): IdentityAccessError {
  return new IdentityAccessError(
    'FORBIDDEN_REACTIVATION',
    `reactivation from "${current}" to "${next}" requires a platform administrator`,
    { current, next },
  );
}

export function forbiddenCrossTenant(
  message = 'actor is not authorized to perform this cross-tenant operation',
): IdentityAccessError {
  return new IdentityAccessError('FORBIDDEN_CROSS_TENANT', message);
}

export function organizationSlugTaken(slug: string): IdentityAccessError {
  return new IdentityAccessError('ORGANIZATION_SLUG_TAKEN', `slug "${slug}" is already in use`, {
    slug,
  });
}

export function organizationNotFound(id: string): IdentityAccessError {
  return new IdentityAccessError('ORGANIZATION_NOT_FOUND', `organization "${id}" not found`, {
    id,
  });
}

export function userEmailTaken(email: string): IdentityAccessError {
  // Callers span two different scopes: same-organization duplicate checks
  // (CreateUser, PatchUserIdentity, MongoUserRepository) and the
  // cross-tenant "duplicate admin email anywhere" bootstrap check
  // (CreateOrganizationWithAdmin) — the message stays scope-neutral so it
  // never claims a scope narrower than the check that actually ran.
  return new IdentityAccessError('USER_EMAIL_TAKEN', `email "${email}" is already in use`, { email });
}

export function userNotFound(id: string): IdentityAccessError {
  return new IdentityAccessError('USER_NOT_FOUND', `user "${id}" not found`, { id });
}
