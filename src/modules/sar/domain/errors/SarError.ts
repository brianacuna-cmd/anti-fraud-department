import { DomainError } from '../../../../shared/kernel/DomainError.js';
import type { SarErrorCode } from './SarErrorCode.js';

/**
 * The one concrete `DomainError` subtype for the whole `sar` module (mirrors
 * `RiskAssessmentError`/`CaseManagementError`). HTTP status mapping lives in
 * the HTTP layer, never here.
 */
export class SarError extends DomainError {
  constructor(
    code: SarErrorCode,
    message: string,
    metadata: Readonly<Record<string, unknown>> = {},
  ) {
    super(code, message, metadata);
  }
}

export function invariantViolation(
  message: string,
  metadata: Readonly<Record<string, unknown>> = {},
): SarError {
  return new SarError('INVARIANT_VIOLATION', message, metadata);
}

export function forbiddenCrossTenant(
  message = 'actor is not authorized to perform this cross-tenant operation',
): SarError {
  return new SarError('FORBIDDEN_CROSS_TENANT', message);
}

export function forbiddenRole(
  roleId: string | null,
  allowed: readonly string[],
): SarError {
  return new SarError(
    'FORBIDDEN_ROLE',
    `role "${roleId ?? 'null'}" is not authorized for this operation`,
    { roleId, allowed: [...allowed] },
  );
}

/**
 * The actor belongs to the governance plane (`ORGANIZATION`, `ADMIN`,
 * `AUDITOR`): they observe the whole tenant and do not operate on it. See
 * `shared/kernel/AccessTier.ts`.
 */
export function forbiddenReadOnly(
  auth: { readonly actorType: string; readonly roleId: string | null },
  allowed: readonly string[],
): SarError {
  const actor = auth.actorType === 'USER' ? (auth.roleId ?? 'null') : auth.actorType;
  return new SarError(
    'FORBIDDEN_ROLE',
    `"${actor}" has read-only access; this operation requires one of: ${allowed.join(', ')}`,
    { actor, allowed: [...allowed], readOnly: true },
  );
}

/** Named after which reference (case vs alert) was passed, for a caller-legible message. */
export function sarSourceNotFound(kind: 'case' | 'amlAlert', id: string): SarError {
  return new SarError(
    'SAR_SOURCE_NOT_FOUND',
    `the referenced ${kind === 'case' ? 'case' : 'AML alert'} "${id}" was not found in this organization`,
    { kind, id },
  );
}

/**
 * The source exists but is not confirmed. Named after WHY it fails, not just
 * that it did — the whole point of the check is to keep an unconfirmed
 * source from ever backing a filed report.
 */
export function sarSourceNotEligible(kind: 'case' | 'amlAlert', id: string): SarError {
  const reason =
    kind === 'case'
      ? 'the case has no FRAUD_CONFIRMED analyst decision on file'
      : 'the AML alert was not resolved as a confirmed match';
  return new SarError('SAR_SOURCE_NOT_ELIGIBLE', reason, { kind, id });
}
