/**
 * Closed set of error codes owned by the `risk-assessment` module (mirrors
 * `CaseManagementErrorCode`). HTTP mapping lives in the HTTP layer later.
 */
export type RiskAssessmentErrorCode =
  | 'INVARIANT_VIOLATION'
  | 'FORBIDDEN_CROSS_TENANT'
  | 'SCORING_RULE_NOT_FOUND';
