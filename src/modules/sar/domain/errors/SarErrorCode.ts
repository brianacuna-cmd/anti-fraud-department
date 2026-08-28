/**
 * Closed set of error codes owned by the `sar` module (mirrors
 * `RiskAssessmentErrorCode`/`CaseManagementErrorCode`).
 */
export type SarErrorCode =
  | 'INVARIANT_VIOLATION'
  | 'FORBIDDEN_CROSS_TENANT'
  | 'FORBIDDEN_ROLE'
  /** The referenced case/AML alert does not exist in this organization. */
  | 'SAR_SOURCE_NOT_FOUND'
  /**
   * The source exists but is not eligible: the case has no `FRAUD_CONFIRMED`
   * decision, or the AML alert was not resolved as a confirmed match. A SAR
   * drafted against an unconfirmed source is exactly the report that cannot
   * be defended before a regulator.
   */
  | 'SAR_SOURCE_NOT_ELIGIBLE';
