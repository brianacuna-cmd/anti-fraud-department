import type { StatusByCode } from '../../../../../../shared/http/errorHandler.js';

/**
 * Code -> HTTP status for every closed `ScreeningErrorCode` (mirrors
 * `caseManagementErrorStatus`). Lives in the HTTP layer, never on the
 * domain error itself.
 */
export const screeningErrorStatus: StatusByCode = {
  INVARIANT_VIOLATION: 400,
  INVALID_TRANSITION: 422,
  FORBIDDEN_CROSS_TENANT: 403,
  AML_ALERT_NOT_FOUND: 404,
};
