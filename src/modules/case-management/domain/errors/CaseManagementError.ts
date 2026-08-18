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

export function forbiddenRole(
  roleId: string | null,
  allowed: readonly string[],
): CaseManagementError {
  return new CaseManagementError(
    'FORBIDDEN_ROLE',
    `role "${roleId ?? 'null'}" is not authorized for this operation`,
    { roleId, allowed: [...allowed] },
  );
}

export function organizationFraudConfigNotFound(organizationId: string): CaseManagementError {
  return new CaseManagementError(
    'ORGANIZATION_FRAUD_CONFIG_NOT_FOUND',
    `no OrganizationFraudConfig exists for organization "${organizationId}"`,
    { organizationId },
  );
}

export function caseNotFound(caseId: string): CaseManagementError {
  return new CaseManagementError('CASE_NOT_FOUND', `case "${caseId}" was not found`, { caseId });
}

export function enforcementActionNotFound(enforcementActionId: string): CaseManagementError {
  return new CaseManagementError(
    'ENFORCEMENT_ACTION_NOT_FOUND',
    `enforcement action "${enforcementActionId}" was not found`,
    { enforcementActionId },
  );
}

export function routingRuleNotFound(ruleId: string): CaseManagementError {
  return new CaseManagementError(
    'ROUTING_RULE_NOT_FOUND',
    `routing rule "${ruleId}" was not found`,
    { ruleId },
  );
}

export function investigationNotFound(investigationId: string): CaseManagementError {
  return new CaseManagementError(
    'INVESTIGATION_NOT_FOUND',
    `investigation "${investigationId}" was not found`,
    { investigationId },
  );
}

export function caseReportNotFound(reportId: string): CaseManagementError {
  return new CaseManagementError('CASE_REPORT_NOT_FOUND', `case report "${reportId}" was not found`, {
    reportId,
  });
}

export function evidenceNotFound(evidenceId: string): CaseManagementError {
  return new CaseManagementError('EVIDENCE_NOT_FOUND', `evidence "${evidenceId}" was not found`, {
    evidenceId,
  });
}
