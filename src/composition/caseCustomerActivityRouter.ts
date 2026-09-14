import { Router } from 'express';
import { requireAuthContext } from '../shared/http/requestAuthContext.js';
import type { Clock } from '../shared/time/Clock.js';
import type { createGetCaseUseCase } from '../modules/case-management/application/GetCase.js';
import type { createGetCustomerCaseHistoryUseCase } from '../modules/case-management/application/GetCustomerCaseHistory.js';
import type { createGetCustomerPaymentActivityUseCase } from '../modules/risk-assessment/application/GetCustomerPaymentActivity.js';
import {
  toActivityVariables,
  toCustomerHistoryVariables,
} from '../modules/risk-assessment/domain/model/CustomerRiskContext.js';

export interface CaseCustomerActivityRouterDeps {
  readonly getCase: ReturnType<typeof createGetCaseUseCase>;
  readonly getCustomerPaymentActivity: ReturnType<typeof createGetCustomerPaymentActivityUseCase>;
  readonly getCustomerCaseHistory: ReturnType<typeof createGetCustomerCaseHistoryUseCase>;
  readonly clock: Clock;
}

const RECENT_LIMIT = 25;

/**
 * Composition HTTP seam: `GET /cases/:caseId/customer-activity`, the case
 * file panel. Same variables the rules read, computed NOW (the values frozen
 * at scoring time stay in the case snapshot), plus the latest payments.
 *
 * `getCase` is the gate: it applies the tenant and not-found rules of reading
 * the case, so the panel is visible exactly to whoever can see the case.
 * Earlier cases leave this one out.
 */
export function caseCustomerActivityRouter(deps: CaseCustomerActivityRouterDeps): Router {
  const router = Router();

  router.get('/cases/:caseId/customer-activity', async (req, res) => {
    const auth = requireAuthContext(req);
    const kase = await deps.getCase({ auth, caseId: req.params.caseId! });
    const anchor = deps.clock.now();
    const customerIds = [kase.customerId, kase.stripeCustomerId, kase.bridgeUserId].filter(
      (id): id is string => typeof id === 'string' && id.length > 0,
    );

    const [{ summary, recent }, cases] = await Promise.all([
      deps.getCustomerPaymentActivity({ auth, customerIds, anchor, recentLimit: RECENT_LIMIT }),
      deps.getCustomerCaseHistory({ auth, customerId: kase.customerId, excludeCaseId: kase.id }),
    ]);

    res.status(200).json({
      caseId: kase.id,
      customerIds,
      computedAt: anchor,
      firstActivityAt: summary.firstActivityAt,
      activity: toActivityVariables(summary),
      customerHistory: toCustomerHistoryVariables(summary, cases, anchor),
      recent: recent.map((row) => {
        const p = row.toProps();
        return {
          id: p.id,
          provider: p.provider,
          providerEventType: p.providerEventType,
          providerReference: p.providerReference,
          kind: p.kind,
          outcome: p.outcome,
          amountCents: p.amountCents,
          currency: p.currency,
          declineCategory: p.declineCategory,
          cardCountry: p.cardCountry,
          billingCountry: p.billingCountry,
          source: p.source,
          occurredAt: p.occurredAt,
        };
      }),
    });
  });

  return router;
}
