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
  WATCHLIST_NOT_FOUND: 404,
  WATCHLIST_NAME_TAKEN: 409,
  WATCHLIST_ENTRY_NOT_FOUND: 404,
  BULK_SCREENING_JOB_NOT_FOUND: 404,
  CSV_HEADER_INVALID: 400,
};
