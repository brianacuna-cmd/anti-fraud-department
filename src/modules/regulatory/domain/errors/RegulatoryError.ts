import { DomainError } from '../../../../shared/kernel/DomainError.js';
import type { RegulatoryErrorCode } from './RegulatoryErrorCode.js';

/** The one concrete `DomainError` subtype for the whole `regulatory` module. */
export class RegulatoryError extends DomainError {
  constructor(
    code: RegulatoryErrorCode,
    message: string,
    metadata: Readonly<Record<string, unknown>> = {},
  ) {
    super(code, message, metadata);
  }
}

export function invariantViolation(
  message: string,
  metadata: Readonly<Record<string, unknown>> = {},
): RegulatoryError {
  return new RegulatoryError('INVARIANT_VIOLATION', message, metadata);
}

export function forbiddenCrossTenant(
  message = 'actor is not authorized to perform this cross-tenant operation',
): RegulatoryError {
  return new RegulatoryError('FORBIDDEN_CROSS_TENANT', message);
}

export function forbiddenRole(roleId: string | null, allowed: readonly string[]): RegulatoryError {
  return new RegulatoryError(
    'FORBIDDEN_ROLE',
    `role "${roleId ?? 'null'}" is not authorized for this operation`,
    { roleId, allowed: [...allowed] },
  );
}

/** The actor observes the tenant and does not operate on it. */
export function forbiddenReadOnly(
  auth: { readonly actorType: string; readonly roleId: string | null },
  allowed: readonly string[],
): RegulatoryError {
  const actor = auth.actorType === 'USER' ? (auth.roleId ?? 'null') : auth.actorType;
  return new RegulatoryError(
    'FORBIDDEN_ROLE',
    `"${actor}" has read-only access; this operation requires one of: ${allowed.join(', ')}`,
    { actor, allowed: [...allowed], readOnly: true },
  );
}

export function regulatoryReportNotFound(id: string): RegulatoryError {
  return new RegulatoryError(
    'REGULATORY_REPORT_NOT_FOUND',
    `no regulatory report "${id}" in this organization`,
    { id },
  );
}

export function reportAlreadyIssued(id: string, issuedAt: string): RegulatoryError {
  return new RegulatoryError(
    'REPORT_ALREADY_ISSUED',
    'an issued report cannot be changed: it is the document the supervisor already holds',
    { id, issuedAt },
  );
}

export function invalidReportingPeriod(reason: string, from: string, to: string): RegulatoryError {
  return new RegulatoryError('INVALID_REPORTING_PERIOD', reason, { from, to });
}
