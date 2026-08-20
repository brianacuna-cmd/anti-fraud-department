import type { StatusByCode } from '../../../../../../shared/http/errorHandler.js';

/**
 * Code -> HTTP status for every closed `RiskAssessmentErrorCode` (mirrors
 * `caseManagementErrorStatus`). Lives in the HTTP layer, never on the
 * domain error itself.
 */
export const riskAssessmentErrorStatus: StatusByCode = {
  INVARIANT_VIOLATION: 400,
  FORBIDDEN_CROSS_TENANT: 403,
  FORBIDDEN_ROLE: 403,
  SCORING_RULE_NOT_FOUND: 404,
};
