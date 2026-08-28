import type { StatusByCode } from '../../../../../../shared/http/errorHandler.js';

/**
 * Code -> HTTP status for every closed `SarErrorCode` (mirrors
 * `riskAssessmentErrorStatus`). Lives in the HTTP layer, never on the
 * domain error itself.
 */
export const sarErrorStatus: StatusByCode = {
  INVARIANT_VIOLATION: 400,
  FORBIDDEN_CROSS_TENANT: 403,
  FORBIDDEN_ROLE: 403,
  SAR_SOURCE_NOT_FOUND: 404,
  // 409 not 400: the request is well formed, the source just is not confirmed yet.
  SAR_SOURCE_NOT_ELIGIBLE: 409,
};
