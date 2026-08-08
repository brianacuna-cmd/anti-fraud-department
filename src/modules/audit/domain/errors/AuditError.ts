import { DomainError } from '../../../../shared/kernel/DomainError.js';

/**
 * The closed error type for the `audit` module (mirrors design D5's
 * one-concrete-DomainError-subtype-per-module convention). The `audit`
 * domain never imports `identity-access`'s `IdentityAccessError` — each
 * bounded context owns its own error hierarchy (design D-A9 boundary rule).
 */
export class AuditError extends DomainError {
  constructor(code: AuditErrorCode, message: string, metadata: Readonly<Record<string, unknown>> = {}) {
    super(code, message, metadata);
  }
}

export type AuditErrorCode = 'INVARIANT_VIOLATION';

export function invariantViolation(
  message: string,
  metadata: Readonly<Record<string, unknown>> = {},
): AuditError {
  return new AuditError('INVARIANT_VIOLATION', message, metadata);
}
