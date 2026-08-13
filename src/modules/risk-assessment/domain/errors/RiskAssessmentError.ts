import { DomainError } from '../../../../shared/kernel/DomainError.js';
import type { RiskAssessmentErrorCode } from './RiskAssessmentErrorCode.js';

/**
 * The one concrete `DomainError` subtype for the whole `risk-assessment`
 * module (mirrors `CaseManagementError`). HTTP status mapping lives in the
 * HTTP layer, never here.
 */
export class RiskAssessmentError extends DomainError {
  constructor(
    code: RiskAssessmentErrorCode,
    message: string,
    metadata: Readonly<Record<string, unknown>> = {},
  ) {
    super(code, message, metadata);
  }
}

export function invariantViolation(
  message: string,
  metadata: Readonly<Record<string, unknown>> = {},
): RiskAssessmentError {
  return new RiskAssessmentError('INVARIANT_VIOLATION', message, metadata);
}

export function forbiddenCrossTenant(
  message = 'actor is not authorized to perform this cross-tenant operation',
): RiskAssessmentError {
  return new RiskAssessmentError('FORBIDDEN_CROSS_TENANT', message);
}

export function scoringRuleNotFound(organizationId: string): RiskAssessmentError {
  return new RiskAssessmentError(
    'SCORING_RULE_NOT_FOUND',
    `no ACTIVE scoring rule exists for organization "${organizationId}"`,
    { organizationId },
  );
}
