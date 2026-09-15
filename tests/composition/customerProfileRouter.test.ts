import { Router, type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { customerProfileRouter } from '../../src/composition/customerProfileRouter.js';
import { createListCasesUseCase } from '../../src/modules/case-management/application/ListCases.js';
import { createGetCustomerCaseHistoryUseCase } from '../../src/modules/case-management/application/GetCustomerCaseHistory.js';
import { Case } from '../../src/modules/case-management/domain/model/aggregates/Case.js';
import { EnforcementAction } from '../../src/modules/case-management/domain/model/aggregates/EnforcementAction.js';
import { createCaseId } from '../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { createRiskScore } from '../../src/modules/case-management/domain/model/value-objects/RiskScore.js';
import { createAnalystDecisionId } from '../../src/modules/case-management/domain/model/value-objects/AnalystDecisionId.js';
import { generateEnforcementActionId } from '../../src/modules/case-management/domain/model/value-objects/EnforcementActionId.js';
import { createEnforcementActionType } from '../../src/modules/case-management/domain/model/value-objects/EnforcementActionType.js';
import {
  FinturuUnavailableError,
  type FinturuMerchantDto,
} from '../../src/modules/case-management/infrastructure/adapters/outbound/finturu/FinturuApiClient.js';
import { caseManagementErrorStatus } from '../../src/modules/case-management/infrastructure/adapters/inbound/http/errorStatus.js';
import { createListAmlAlertsUseCase } from '../../src/modules/screening/application/ListAmlAlerts.js';
import { AmlAlert } from '../../src/modules/screening/domain/model/aggregates/AmlAlert.js';
import { generateAmlAlertId } from '../../src/modules/screening/domain/model/value-objects/AmlAlertId.js';
import { createWatchlistEntryId } from '../../src/modules/screening/domain/model/value-objects/WatchlistEntryId.js';
import { createWatchlistId } from '../../src/modules/screening/domain/model/value-objects/WatchlistId.js';
import { createMatchScore } from '../../src/modules/screening/domain/model/value-objects/MatchScore.js';
import { createScreeningMatch } from '../../src/modules/screening/domain/model/entities/ScreeningMatch.js';
import { createGetCustomerPaymentActivityUseCase } from '../../src/modules/risk-assessment/application/GetCustomerPaymentActivity.js';
import { createApp } from '../../src/shared/http/createApp.js';
import { createErrorHandler } from '../../src/shared/http/errorHandler.js';
import { attachAuthContext } from '../../src/shared/http/requestAuthContext.js';
import { createAuthContext, type AuthContext } from '../../src/shared/kernel/AuthContext.js';
import { InMemoryCaseRepository } from '../helpers/case-management/InMemoryCaseRepository.js';
import { InMemoryEnforcementActionRepository } from '../helpers/case-management/InMemoryEnforcementActionRepository.js';
import { InMemoryAmlAlertRepository } from '../helpers/screening/InMemoryAmlAlertRepository.js';
import { InMemoryPaymentActivityRepository } from '../helpers/risk-assessment/InMemoryPaymentActivityRepository.js';
import { ANCHOR, activity, hoursBefore } from '../helpers/risk-assessment/paymentActivityFixtures.js';
import { FixedClock } from '../helpers/FixedClock.js';
import { oid } from '../support/oid.js';

const ORG = oid('org-1');
const ANALYST = createAuthContext({ userId: oid('an'), organizationId: ORG, actorType: 'USER', roleId: 'ANALYST' });
const NO_MERCHANT_ROLE = createAuthContext({ userId: oid('x'), organizationId: ORG, actorType: 'USER', roleId: 'COMPLIANCE' });
const CUSTOMER = '42';

const MERCHANT: FinturuMerchantDto = {
  userId: 42,
  name: 'Ana Pérez',
  email: 'ana@tienda.co',
  createdAt: '2025-01-01T00:00:00.000Z',
  companyName: 'Tienda Uno',
  companyCountry: 'CO',
  stripeAccountId: 'acct_ana',
  stripeAccountStatus: 'completed',
  stripeAccountRisk: 'MID',
  links: { total: 3, paid: 2, refused: 1, expired: 0, refunded: 0, paidAmount: 150, refundedAmount: 0, firstLinkAt: null, lastLinkAt: null },
};

async function buildApp(options: { auth?: AuthContext; getMerchant?: (userId: number) => Promise<FinturuMerchantDto | null> } = {}) {
  const cases = new InMemoryCaseRepository();
  const alerts = new InMemoryAmlAlertRepository();
  const actions = new InMemoryEnforcementActionRepository();
  const activities = new InMemoryPaymentActivityRepository();

  const kase = Case.create({
    id: createCaseId(oid('case-1')),
    organizationId: ORG,
    customerId: CUSTOMER,
    stripeCustomerId: 'cus_stripe_42',
    riskScore: createRiskScore(80),
    priority: 'HIGH',
    now: ANCHOR,
  });
  await cases.save(kase);
  await cases.save(
    Case.create({ id: createCaseId(oid('case-other')), organizationId: ORG, customerId: '7', riskScore: createRiskScore(10), priority: 'LOW', now: ANCHOR }),
  );
  await actions.save(
    EnforcementAction.create({
      id: generateEnforcementActionId(),
      caseId: kase.id,
      organizationId: ORG,
      analystDecisionId: createAnalystDecisionId(oid('decision-1')),
      actionType: createEnforcementActionType('BLOCK'),
      targetType: 'CUSTOMER',
      targetId: CUSTOMER,
      createdBy: oid('an'),
      now: ANCHOR,
    }),
  );
  await alerts.save(
    AmlAlert.create({
      id: generateAmlAlertId(),
      organizationId: ORG,
      customerId: CUSTOMER,
      suspectedEntity: 'Ana Perez',
      confidence: createMatchScore(64),
      detectionSource: 'index',
      severity: 'MEDIUM',
      matchedEntry: createScreeningMatch({
        entryId: createWatchlistEntryId(oid('entry-1')),
        watchlistId: createWatchlistId(oid('watchlist-1')),
        name: 'Ana Perez',
        matchField: 'NAME',
        algorithm: 'JARO_WINKLER',
      }),
      now: ANCHOR,
    }),
  );
  // Known only by the Stripe id found on the case.
  await activities.record(activity({ customerId: 'cus_stripe_42', occurredAt: hoursBefore(2), outcome: 'FAILED', providerEventType: 'charge.failed' }));
  // Known only by the Bridge id passed in the query.
  await activities.record(activity({ customerId: 'bridge_42', occurredAt: hoursBefore(3) }));

  const mounted = Router();
  mounted.use((req: Request, _res: Response, next: NextFunction) => {
    attachAuthContext(req, options.auth ?? ANALYST);
    next();
  });
  mounted.use(
    customerProfileRouter({
      listCases: createListCasesUseCase({ cases }),
      listAmlAlerts: createListAmlAlertsUseCase({ amlAlertRepository: alerts }),
      enforcementActions: actions,
      getCustomerPaymentActivity: createGetCustomerPaymentActivityUseCase({ activities }),
      getCustomerCaseHistory: createGetCustomerCaseHistoryUseCase({
        reader: { countByCustomer: async () => ({ previousCases: 1, openCases: 1, fraudConfirmedCases: 0, falsePositiveCases: 0 }) },
      }),
      activities,
      finturu: { getMerchant: options.getMerchant ?? (async (userId) => (userId === 42 ? MERCHANT : null)) },
      clock: new FixedClock(ANCHOR),
    }),
  );
  return createApp({ routers: [{ path: '/api/v1', router: mounted }], errorHandler: createErrorHandler(caseManagementErrorStatus) });
}

describe('GET /customers/:customerId/profile', () => {
  it('puts cases, AML alerts, measures, activity by every known id and merchant risk on one page', async () => {
    const app = await buildApp();

    const response = await request(app).get(`/api/v1/customers/${CUSTOMER}/profile?bridgeUserId=bridge_42`);

    expect(response.status).toBe(200);
    expect(response.body.cases.map((c: { customerId: string }) => c.customerId)).toEqual([CUSTOMER]);
    expect(response.body.amlAlerts).toHaveLength(1);
    expect(response.body.enforcementActions.map((a: { actionType: string }) => a.actionType)).toEqual(['BLOCK']);
    expect(response.body.customerIds).toEqual(expect.arrayContaining([CUSTOMER, 'cus_stripe_42', 'bridge_42']));
    expect(response.body.activity).toMatchObject({ attempts24h: 2, failedAttempts24h: 1 });
    expect(response.body.recent).toHaveLength(2);
    expect(response.body.merchantStatus).toBe('OK');
    expect(response.body.merchant).toMatchObject({ userId: 42, risk: expect.any(Object) });
  });

  it('answers without the merchant half when Finturu fails, the user is not a merchant, or the role cannot read merchants', async () => {
    const down = await buildApp({
      getMerchant: async () => {
        throw new FinturuUnavailableError('/merchant/42', 503);
      },
    });
    const notMerchant = await buildApp({ getMerchant: async () => null });
    const forbidden = await buildApp({ auth: NO_MERCHANT_ROLE });

    const [a, b, c] = await Promise.all([
      request(down).get(`/api/v1/customers/${CUSTOMER}/profile`),
      request(notMerchant).get(`/api/v1/customers/${CUSTOMER}/profile`),
      request(forbidden).get(`/api/v1/customers/${CUSTOMER}/profile`),
    ]);

    expect([a.status, b.status, c.status]).toEqual([200, 200, 200]);
    expect([a.body.merchantStatus, b.body.merchantStatus, c.body.merchantStatus]).toEqual(['UNAVAILABLE', 'NOT_A_MERCHANT', 'FORBIDDEN']);
    expect(a.body.merchant).toBeNull();
  });
});
