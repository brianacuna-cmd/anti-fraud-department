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

export function forbiddenRole(
  roleId: string | null,
  allowed: readonly string[],
): RiskAssessmentError {
  return new RiskAssessmentError(
    'FORBIDDEN_ROLE',
    `role "${roleId ?? 'null'}" is not authorized for this operation`,
    { roleId, allowed: [...allowed] },
  );
}

/**
 * El actor pertenece al plano de gobierno (`ORGANIZATION`, `ADMIN`,
 * `AUDITOR`): observa el inquilino entero y no opera sobre el. Ver
 * `shared/kernel/AccessTier.ts`.
 */
export function forbiddenReadOnly(
  auth: { readonly actorType: string; readonly roleId: string | null },
  allowed: readonly string[],
): RiskAssessmentError {
  const actor = auth.actorType === 'USER' ? (auth.roleId ?? 'null') : auth.actorType;
  return new RiskAssessmentError(
    'FORBIDDEN_ROLE',
    `"${actor}" has read-only access; this operation requires one of: ${allowed.join(', ')}`,
    { actor, allowed: [...allowed], readOnly: true },
  );
}

export function scoringRuleNotFound(organizationId: string): RiskAssessmentError {
  return new RiskAssessmentError(
    'SCORING_RULE_NOT_FOUND',
    `no ACTIVE scoring rule exists for organization "${organizationId}"`,
    { organizationId },
  );
}

export function scoringRuleByIdNotFound(ruleId: string): RiskAssessmentError {
  return new RiskAssessmentError(
    'SCORING_RULE_NOT_FOUND',
    `scoring rule "${ruleId}" was not found`,
    { ruleId },
  );
}
