/**
 * Optional outbound port — looks up the most recent OPEN or IN_REVIEW case
 * for a customer so the use case can call `alert.linkCase(caseId)` (D5).
 *
 * When this dependency is `undefined` at the composition root, the feature is
 * off and the use case skips the link step silently. The job MUST NOT call
 * `CreateCase` — that is human-only escalation via `EscalateAmlAlert`.
 *
 * Bridge implementation: `CaseRepository.findByCustomerOrBridgeId({
 *   statuses: ['OPEN', 'IN_REVIEW'] })`.
 */
export interface WalletRescreenCaseLinker {
  /**
   * Returns the case identifier of the most recent OPEN or IN_REVIEW case for
   * `(organizationId, customerId)`, or `null` when none exists.
   */
  find(organizationId: string, customerId: string): Promise<string | null>;
}
