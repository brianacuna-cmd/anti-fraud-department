import type { SarSourceCheck, SarSourceVerifier } from '../modules/sar/domain/ports/SarSourceVerifier.js';
import type { CaseRepository } from '../modules/case-management/domain/ports/CaseRepository.js';
import type { AnalystDecisionRepository } from '../modules/case-management/domain/ports/AnalystDecisionRepository.js';
import type { AmlAlertRepository } from '../modules/screening/domain/ports/AmlAlertRepository.js';
import { createCaseId } from '../modules/case-management/domain/model/value-objects/CaseId.js';
import { createAmlAlertId } from '../modules/screening/domain/model/value-objects/AmlAlertId.js';

const NOT_FOUND: SarSourceCheck = { exists: false, eligible: false };

/**
 * Composition-root implementation of `sar`'s own `SarSourceVerifier` port —
 * same pattern as `walletRescreenCaseLinker.ts`: a narrow port lives in the
 * new module's domain, and THIS file (the one legal seam for a cross-module
 * import) wires it to the real repositories of `case-management` and
 * `screening`.
 *
 * "Eligible" mirrors what `ResolveCase.ts`'s `assertEnforcementResolved`
 * already treats as the confirmed-fraud signal for a case (`some decision
 * is FRAUD_CONFIRMED`), and what `ResolveAmlAlert.ts` maps a
 * `CONFIRMED_MATCH` verdict to (`status: 'RESOLVED'` — the only path that
 * reaches that status, so it is a reliable proxy without reading the audit
 * log).
 */
export function createSarSourceVerifier(
  cases: CaseRepository,
  analystDecisions: AnalystDecisionRepository,
  amlAlerts: AmlAlertRepository,
): SarSourceVerifier {
  return {
    async verifyCase(organizationId, caseId) {
      let id;
      try {
        id = createCaseId(caseId);
      } catch {
        return NOT_FOUND;
      }
      const kase = await cases.findById(id);
      if (kase === null || kase.deletedAt !== null || kase.organizationId !== organizationId) {
        return NOT_FOUND;
      }
      const decisions = await analystDecisions.findByCaseId(kase.id);
      return { exists: true, eligible: decisions.some((d) => d.decision === 'FRAUD_CONFIRMED') };
    },

    async verifyAmlAlert(organizationId, amlAlertId) {
      let id;
      try {
        id = createAmlAlertId(amlAlertId);
      } catch {
        return NOT_FOUND;
      }
      const alert = await amlAlerts.findById(id);
      if (alert === null || alert.organizationId !== organizationId) {
        return NOT_FOUND;
      }
      return { exists: true, eligible: alert.status === 'RESOLVED' };
    },
  };
}
