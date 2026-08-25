/**
 * Closed set of error codes owned by the `screening` module (mirrors
 * `RiskAssessmentErrorCode`). HTTP mapping lives in the HTTP layer later.
 */
export type ScreeningErrorCode =
  | 'INVARIANT_VIOLATION'
  | 'INVALID_TRANSITION'
  | 'FORBIDDEN_CROSS_TENANT'
  | 'AML_ALERT_NOT_FOUND'
  | 'WATCHLIST_NOT_FOUND'
  | 'WATCHLIST_NAME_TAKEN'
  | 'WATCHLIST_ENTRY_NOT_FOUND'
  | 'BULK_SCREENING_JOB_NOT_FOUND'
  | 'CSV_HEADER_INVALID';
