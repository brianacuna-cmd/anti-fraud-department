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
  | 'SAR_SOURCE_NOT_ELIGIBLE'
  /** No `sar_reports` row with this id in this organization. */
  | 'SAR_REPORT_NOT_FOUND'
  /** The report is not in a state that admits the requested transition (e.g. already APPROVED). */
  | 'INVALID_TRANSITION'
  /**
   * Four eyes (SAR-002): whoever drafted the report cannot be the one who
   * approves and locks it.
   */
  | 'SELF_APPROVAL_FORBIDDEN'
  /**
   * The report cannot be turned into a filing document yet: the tenant has
   * no filing profile, or required fields are missing or out of range. The
   * error carries the full list of defects — one per attempt would turn a
   * form into a round trip per field.
   */
  | 'SAR_NOT_READY_TO_FILE';
