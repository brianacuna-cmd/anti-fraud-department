import type { createCreateCaseUseCase } from '../modules/case-management/application/CreateCase.js';
import type { AmlAlertCaseOpener } from '../modules/screening/application/EscalateAmlAlert.js';

/**
 * Composition-root adapter (eslint boundaries): screening escalate talks to
 * an `AmlAlertCaseOpener` port; this wrapper is the only place that calls
 * `CreateCase`. False-positive triage never reaches here.
 */
export function createAmlAlertCaseOpener(
  createCase: ReturnType<typeof createCreateCaseUseCase>,
): AmlAlertCaseOpener {
  return {
    async open(input) {
      const opened = await createCase({
        auth: input.auth,
        customerId: input.customerId,
        riskScore: input.riskScore,
        priority: input.priority,
        tags: input.tags,
        idempotencyKey: input.idempotencyKey,
      });
      return { caseId: opened.id };
    },
  };
}
