import { DomainError } from '../../../../shared/kernel/DomainError.js';
import type { CaseManagementErrorCode } from './CaseManagementErrorCode.js';

/**
 * The one concrete `DomainError` subtype for the whole `case-management`
 * module (mirrors `IdentityAccessError`). HTTP status mapping lives in the
 * HTTP layer (`infrastructure/adapters/inbound/http/errorStatus.ts`), never
 * here.
 */
export class CaseManagementError extends DomainError {
  constructor(
    code: CaseManagementErrorCode,
    message: string,
    metadata: Readonly<Record<string, unknown>> = {},
  ) {
    super(code, message, metadata);
  }
}

export function invariantViolation(
  message: string,
  metadata: Readonly<Record<string, unknown>> = {},
): CaseManagementError {
  return new CaseManagementError('INVARIANT_VIOLATION', message, metadata);
}

export function invalidTransition(current: string, next: string): CaseManagementError {
  return new CaseManagementError(
    'INVALID_TRANSITION',
    `cannot transition from "${current}" to "${next}"`,
    { current, next },
  );
}

export function forbiddenCrossTenant(
  message = 'actor is not authorized to perform this cross-tenant operation',
): CaseManagementError {
  return new CaseManagementError('FORBIDDEN_CROSS_TENANT', message);
}

export function organizationFraudConfigNotFound(organizationId: string): CaseManagementError {
  return new CaseManagementError(
    'ORGANIZATION_FRAUD_CONFIG_NOT_FOUND',
    `no OrganizationFraudConfig exists for organization "${organizationId}"`,
    { organizationId },
  );
}

export function caseNotFound(caseId: string): CaseManagementError {
  return new CaseManagementError(
    'CASE_NOT_FOUND',
    `case with id "${caseId}" was not found`,
    { caseId },
  );
}
