/**
 * Closed set of error codes owned by the `risk-assessment` module (mirrors
 * `CaseManagementErrorCode`). HTTP mapping lives in the HTTP layer later.
 */
export type RiskAssessmentErrorCode =
  | 'INVARIANT_VIOLATION'
  | 'FORBIDDEN_CROSS_TENANT'
  | 'FORBIDDEN_ROLE'
  | 'SCORING_RULE_NOT_FOUND'
  /**
   * A scoring rule cannot be deleted while ACTIVE: it is still what scores
   * incoming events. Activate another rule to relieve it first, so the
   * change is on record as such and not as a disappearance.
   */
  | 'SCORING_RULE_ACTIVE';
