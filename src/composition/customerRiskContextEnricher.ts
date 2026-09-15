import type { AuthContext } from '../shared/kernel/AuthContext.js';
import {
  createCanonicalRiskEvent,
  type CanonicalRiskEvent,
} from '../modules/risk-assessment/domain/model/CanonicalRiskEvent.js';
import {
  toActivityVariables,
  toCustomerHistoryVariables,
} from '../modules/risk-assessment/domain/model/CustomerRiskContext.js';
import type { createGetCustomerPaymentActivityUseCase } from '../modules/risk-assessment/application/GetCustomerPaymentActivity.js';
import type { createGetCustomerCaseHistoryUseCase } from '../modules/case-management/application/GetCustomerCaseHistory.js';

export interface CustomerRiskContextEnricherDeps {
  readonly getCustomerPaymentActivity: ReturnType<typeof createGetCustomerPaymentActivityUseCase>;
  readonly getCustomerCaseHistory: ReturnType<typeof createGetCustomerCaseHistoryUseCase>;
}

export type EnrichRiskEvent = (input: {
  readonly auth: AuthContext;
  readonly event: CanonicalRiskEvent;
}) => Promise<CanonicalRiskEvent>;

/**
 * Composition-root seam (eslint boundaries): joins the customer's payment
 * history (risk-assessment) with their earlier cases (case-management) into
 * the `activity.*` / `customerHistory.*` variables the rules read.
 *
 * Windows are anchored on the EVENT's `createdAt`, not on "now": a late
 * webhook or an imported row is scored against what had happened by the time
 * it happened. Whatever the caller sent in those two namespaces is replaced —
 * they are ours to compute, not the caller's to assert.
 */
export function createCustomerRiskContextEnricher(deps: CustomerRiskContextEnricherDeps): EnrichRiskEvent {
  return async function enrichRiskEvent({ auth, event }) {
    const [{ summary, context }, cases] = await Promise.all([
      deps.getCustomerPaymentActivity({
        auth,
        customerIds: [event.caseCustomerId],
        anchor: event.createdAt,
        recentLimit: 0,
        paymentLinkReference: event.paymentLinkReference ?? null,
        merchantId: event.merchantId ?? null,
      }),
      deps.getCustomerCaseHistory({ auth, customerId: event.caseCustomerId }),
    ]);
    return createCanonicalRiskEvent({
      ...event,
      activity: toActivityVariables(summary, context),
      customerHistory: toCustomerHistoryVariables(summary, cases, event.createdAt),
    });
  };
}
