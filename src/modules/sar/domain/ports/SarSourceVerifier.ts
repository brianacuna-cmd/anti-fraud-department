/**
 * One check per source kind: does it exist in this org, and is it eligible
 * to back a SAR? "Eligible" means a case with a `FRAUD_CONFIRMED` analyst
 * decision, or an AML alert resolved as a confirmed match.
 */
export interface SarSourceCheck {
  readonly exists: boolean;
  readonly eligible: boolean;
}

/**
 * Narrow port for cross-module verification — same pattern as
 * `screening/domain/ports/WalletRescreenCaseLinker.ts`. `sar`'s domain
 * never imports `case-management`'s or `screening`'s domain directly
 * (eslint `boundaries` forbids it); the composition root implements this
 * port by wrapping the real repositories of those modules.
 */
export interface SarSourceVerifier {
  verifyCase(organizationId: string, caseId: string): Promise<SarSourceCheck>;
  verifyAmlAlert(organizationId: string, amlAlertId: string): Promise<SarSourceCheck>;
}
