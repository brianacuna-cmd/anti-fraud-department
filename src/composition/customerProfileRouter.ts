import { Router } from 'express';
import { requireAuthContext } from '../shared/http/requestAuthContext.js';
import type { AuthContext } from '../shared/kernel/AuthContext.js';
import type { Clock } from '../shared/time/Clock.js';
import type { Instant } from '../shared/time/Instant.js';
import type { createListCasesUseCase } from '../modules/case-management/application/ListCases.js';
import type { createGetCustomerCaseHistoryUseCase } from '../modules/case-management/application/GetCustomerCaseHistory.js';
import type { EnforcementActionRepository } from '../modules/case-management/domain/ports/EnforcementActionRepository.js';
import { toCaseResponse } from '../modules/case-management/infrastructure/adapters/inbound/http/mappers/CaseHttpMapper.js';
import { toEnforcementActionResponse } from '../modules/case-management/infrastructure/adapters/inbound/http/mappers/EnforcementHttpMapper.js';
import {
  FinturuUnavailableError,
  type FinturuApiClient,
} from '../modules/case-management/infrastructure/adapters/outbound/finturu/FinturuApiClient.js';
import type { createListAmlAlertsUseCase } from '../modules/screening/application/ListAmlAlerts.js';
import { toAmlAlertResponse } from '../modules/screening/infrastructure/adapters/inbound/http/mappers/AmlAlertHttpMapper.js';
import type { createGetCustomerPaymentActivityUseCase } from '../modules/risk-assessment/application/GetCustomerPaymentActivity.js';
import { requireReadRole, MERCHANT_READ_ROLES } from '../modules/risk-assessment/application/authorization/policy.js';
import type { PaymentActivityRepository } from '../modules/risk-assessment/domain/ports/PaymentActivityRepository.js';
import {
  toActivityVariables,
  toCustomerHistoryVariables,
} from '../modules/risk-assessment/domain/model/CustomerRiskContext.js';
import { toRecentActivityResponse } from './caseCustomerActivityRouter.js';
import { assessMerchantWithRisk } from './merchantRiskRouter.js';

export interface CustomerProfileRouterDeps {
  readonly listCases: ReturnType<typeof createListCasesUseCase>;
  readonly listAmlAlerts: ReturnType<typeof createListAmlAlertsUseCase>;
  readonly enforcementActions: EnforcementActionRepository;
  readonly getCustomerPaymentActivity: ReturnType<typeof createGetCustomerPaymentActivityUseCase>;
  readonly getCustomerCaseHistory: ReturnType<typeof createGetCustomerCaseHistoryUseCase>;
  readonly activities: PaymentActivityRepository;
  readonly finturu: Pick<FinturuApiClient, 'getMerchant'>;
  readonly clock: Clock;
}

export const PROFILE_CASES_LIMIT = 100;
export const PROFILE_ALERTS_LIMIT = 100;
const RECENT_LIMIT = 25;

type MerchantSection = 'OK' | 'NOT_A_MERCHANT' | 'UNAVAILABLE' | 'FORBIDDEN';

/**
 * Composition HTTP seam: `GET /customers/:customerId/profile`, the single
 * profile of a person or a company.
 *
 * Deciding on someone used to mean visiting the case inbox, the AML inbox,
 * the measures ledger, the case activity panel and, for a business, the
 * merchants screen. This puts on one page what each of those already
 * computes: every case of the customer, their AML alerts, the measures
 * requested in those cases, payment activity with the same variables the
 * rules read, and — when the Finturu user is also a merchant — the merchant
 * risk assessment.
 *
 * Payment activity is looked up by every id the customer is known by: the
 * Finturu id, plus the Stripe and Bridge ids found on their cases or passed
 * as `stripeCustomerId` / `bridgeUserId` (the directory knows them before
 * any case exists).
 *
 * The merchant half degrades instead of failing the page: `merchantStatus`
 * says whether the user is not a merchant, Finturu did not answer, or the
 * caller's role cannot read merchants.
 */
export function customerProfileRouter(deps: CustomerProfileRouterDeps): Router {
  const router = Router();

  router.get('/customers/:customerId/profile', async (req, res) => {
    const auth = requireAuthContext(req);
    const customerId = req.params.customerId!;
    const now = deps.clock.now();

    const [casePage, alertPage] = await Promise.all([
      deps.listCases({ auth, customerId, limit: PROFILE_CASES_LIMIT, offset: 0 }),
      deps.listAmlAlerts({ auth, customerId, limit: PROFILE_ALERTS_LIMIT, offset: 0 }),
    ]);
    const cases = casePage.items;

    const customerIds = unique([
      customerId,
      queryString(req.query.stripeCustomerId),
      queryString(req.query.bridgeUserId),
      ...cases.flatMap((kase) => [kase.stripeCustomerId, kase.bridgeUserId]),
    ]);

    const [actionsPerCase, activity, history, merchant] = await Promise.all([
      Promise.all(cases.map((kase) => deps.enforcementActions.findByCaseId(kase.id))),
      deps.getCustomerPaymentActivity({ auth, customerIds, anchor: now, recentLimit: RECENT_LIMIT }),
      deps.getCustomerCaseHistory({ auth, customerId }),
      loadMerchant(deps, auth, customerId, now),
    ]);

    const actions = actionsPerCase
      .flat()
      .sort((a, b) => (b.createdAt as string).localeCompare(a.createdAt as string));

    res.status(200).json({
      customerId,
      customerIds,
      computedAt: now,
      cases: cases.map(toCaseResponse),
      casesTotal: casePage.total,
      amlAlerts: alertPage.items.map(toAmlAlertResponse),
      amlAlertsTotal: alertPage.total,
      enforcementActions: actions.map(toEnforcementActionResponse),
      firstActivityAt: activity.summary.firstActivityAt,
      activity: toActivityVariables(activity.summary),
      customerHistory: toCustomerHistoryVariables(activity.summary, history, now),
      recent: activity.recent.map(toRecentActivityResponse),
      merchantStatus: merchant.status,
      merchant: merchant.merchant,
    });
  });

  return router;
}

async function loadMerchant(
  deps: CustomerProfileRouterDeps,
  auth: AuthContext,
  customerId: string,
  now: Instant,
): Promise<{ status: MerchantSection; merchant: unknown }> {
  const userId = Number(customerId);
  if (!Number.isInteger(userId) || userId <= 0) {
    return { status: 'NOT_A_MERCHANT', merchant: null };
  }
  try {
    requireReadRole(auth, MERCHANT_READ_ROLES);
  } catch {
    return { status: 'FORBIDDEN', merchant: null };
  }
  try {
    const merchant = await deps.finturu.getMerchant(userId);
    if (merchant === null) {
      return { status: 'NOT_A_MERCHANT', merchant: null };
    }
    return { status: 'OK', merchant: await assessMerchantWithRisk(deps, auth, merchant, now) };
  } catch (error) {
    if (error instanceof FinturuUnavailableError) {
      return { status: 'UNAVAILABLE', merchant: null };
    }
    throw error;
  }
}

function queryString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function unique(ids: readonly (string | null)[]): string[] {
  return [...new Set(ids.filter((id): id is string => id !== null && id.length > 0))];
}
