/**
 * Closed set of error codes owned by the `screening` module (mirrors
 * `RiskAssessmentErrorCode`). HTTP mapping lives in the HTTP layer later.
 */
export type ScreeningErrorCode =
  | 'INVARIANT_VIOLATION'
  | 'INVALID_TRANSITION'
  | 'FORBIDDEN_CROSS_TENANT'
  | 'AML_ALERT_NOT_FOUND';
