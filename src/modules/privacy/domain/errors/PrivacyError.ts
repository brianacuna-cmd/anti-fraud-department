import { DomainError } from '../../../../shared/kernel/DomainError.js';
import type { PrivacyErrorCode } from './PrivacyErrorCode.js';

/**
 * The one concrete `DomainError` subtype for the whole `privacy` module
 * (mirrors `SarError`/`RiskAssessmentError`). HTTP status mapping lives in
 * the HTTP layer, never here.
 */
export class PrivacyError extends DomainError {
  constructor(
    code: PrivacyErrorCode,
    message: string,
    metadata: Readonly<Record<string, unknown>> = {},
  ) {
    super(code, message, metadata);
  }
}

export function invariantViolation(
  message: string,
  metadata: Readonly<Record<string, unknown>> = {},
): PrivacyError {
  return new PrivacyError('INVARIANT_VIOLATION', message, metadata);
}

export function forbiddenCrossTenant(
  message = 'actor is not authorized to perform this cross-tenant operation',
): PrivacyError {
  return new PrivacyError('FORBIDDEN_CROSS_TENANT', message);
}

export function forbiddenRole(roleId: string | null, allowed: readonly string[]): PrivacyError {
  return new PrivacyError(
    'FORBIDDEN_ROLE',
    `role "${roleId ?? 'null'}" is not authorized for this operation`,
    { roleId, allowed: [...allowed] },
  );
}

export function privacyRequestNotFound(id: string): PrivacyError {
  return new PrivacyError('PRIVACY_REQUEST_NOT_FOUND', `no privacy request "${id}" in this organization`, {
    id,
  });
}

export function invalidTransition(from: string, to: string, id: string): PrivacyError {
  return new PrivacyError('INVALID_TRANSITION', `a privacy request cannot go from ${from} to ${to}`, {
    from,
    to,
    id,
  });
}

/**
 * Every record the subject asked to erase is under a retention duty.
 *
 * `retainedUntil` and `basis` travel with the error because the answer the
 * subject is owed is not "no" — it is "no, until this date, because of this
 * rule". Losing that turns a lawful refusal into one that looks arbitrary.
 */
export function erasureBarredByRetention(
  subject: string,
  basis: string,
  retainedUntil: string | null,
): PrivacyError {
  return new PrivacyError(
    'ERASURE_BARRED_BY_RETENTION',
    'no data could be erased: every matching record is under a legal retention duty',
    { subject, basis, retainedUntil },
  );
}

/**
 * The actor belongs to the governance plane (`ORGANIZATION`, `ADMIN`,
 * `AUDITOR`): they observe the whole tenant and do not operate on it.
 */
export function forbiddenReadOnly(
  auth: { readonly actorType: string; readonly roleId: string | null },
  allowed: readonly string[],
): PrivacyError {
  const actor = auth.actorType === 'USER' ? (auth.roleId ?? 'null') : auth.actorType;
  return new PrivacyError(
    'FORBIDDEN_ROLE',
    `"${actor}" has read-only access; this operation requires one of: ${allowed.join(', ')}`,
    { actor, allowed: [...allowed], readOnly: true },
  );
}
