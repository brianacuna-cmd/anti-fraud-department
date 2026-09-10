/**
 * Closed set of error codes owned by the `regulatory` module (mirrors
 * `PrivacyErrorCode`/`SarErrorCode`).
 */
export type RegulatoryErrorCode =
  | 'INVARIANT_VIOLATION'
  | 'FORBIDDEN_CROSS_TENANT'
  | 'FORBIDDEN_ROLE'
  /** No `regulatory_reports` row with this id in this organization. */
  | 'REGULATORY_REPORT_NOT_FOUND'
  /**
   * The report is already issued. An issued report is what was handed to a
   * supervisor: recompiling or re-issuing it would change a document that
   * exists outside this system, under a number somebody already quoted.
   */
  | 'REPORT_ALREADY_ISSUED'
  /** The period makes no sense: inverted, empty, or reaching into the future. */
  | 'INVALID_REPORTING_PERIOD';
