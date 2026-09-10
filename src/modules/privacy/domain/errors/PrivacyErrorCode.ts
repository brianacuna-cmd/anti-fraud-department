/**
 * Closed set of error codes owned by the `privacy` module (mirrors
 * `SarErrorCode`/`RiskAssessmentErrorCode`).
 */
export type PrivacyErrorCode =
  | 'INVARIANT_VIOLATION'
  | 'FORBIDDEN_CROSS_TENANT'
  | 'FORBIDDEN_ROLE'
  /** No `privacy_data_requests` row with this id in this organization. */
  | 'PRIVACY_REQUEST_NOT_FOUND'
  /**
   * The request is not in a state that admits the transition — resolving one
   * already resolved, or erasing against a request that was rejected.
   */
  | 'INVALID_TRANSITION'
  /**
   * The erasure was asked for on a subject whose records the tenant is
   * legally required to keep, and NOTHING could be masked without breaking
   * that duty.
   *
   * It is a distinct code and not a generic invariant on purpose: this is the
   * one refusal a data subject can appeal, and the regulator will ask which
   * legal basis was invoked. A 422 with "invalid request" would lose exactly
   * the fact that has to be defensible.
   */
  | 'ERASURE_BARRED_BY_RETENTION';
