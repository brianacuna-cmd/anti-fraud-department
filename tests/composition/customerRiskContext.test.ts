import { Router, type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { createCustomerRiskContextEnricher } from '../../src/composition/customerRiskContextEnricher.js';
import { createScoreToCaseOrchestrator } from '../../src/composition/scoreToCaseOrchestrator.js';
import { createWebhookToScoreOrchestrator } from '../../src/composition/webhookToScoreOrchestrator.js';
import { caseCustomerActivityRouter } from '../../src/composition/caseCustomerActivityRouter.js';
import { createPaymentCustomerLookup } from '../../src/composition/paymentCustomerLookup.js';
import { createGetCustomerPaymentActivityUseCase } from '../../src/modules/risk-assessment/application/GetCustomerPaymentActivity.js';
import { createRecordPaymentActivityUseCase } from '../../src/modules/risk-assessment/application/RecordPaymentActivity.js';
import { generatePaymentActivityId } from '../../src/modules/risk-assessment/domain/model/value-objects/PaymentActivityId.js';
import { createCanonicalRiskEvent, type CanonicalRiskEvent } from '../../src/modules/risk-assessment/domain/model/CanonicalRiskEvent.js';
import type { CalculateRiskScoreResult } from '../../src/modules/risk-assessment/application/CalculateRiskScore.js';
import { createGetCustomerCaseHistoryUseCase } from '../../src/modules/case-management/application/GetCustomerCaseHistory.js';
import { createGetCaseUseCase } from '../../src/modules/case-management/application/GetCase.js';
import { Case } from '../../src/modules/case-management/domain/model/aggregates/Case.js';
import { createCaseId } from '../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { createRiskScore } from '../../src/modules/case-management/domain/model/value-objects/RiskScore.js';
import { OrganizationFraudConfig } from '../../src/modules/case-management/domain/model/aggregates/OrganizationFraudConfig.js';
import { generateOrganizationFraudConfigId } from '../../src/modules/case-management/domain/model/value-objects/OrganizationFraudConfigId.js';
import type { CustomerCaseHistoryQuery } from '../../src/modules/case-management/domain/ports/CustomerCaseHistoryReader.js';
import { createIngestedPaymentEvent } from '../../src/modules/ingest/domain/model/IngestedPaymentEvent.js';
import { ProviderIngestEvent } from '../../src/modules/ingest/domain/model/aggregates/ProviderIngestEvent.js';
import { generateProviderIngestEventId } from '../../src/modules/ingest/domain/model/value-objects/ProviderIngestEventId.js';
import type { ProviderIngestEventRepository } from '../../src/modules/ingest/domain/ports/ProviderIngestEventRepository.js';
import { createApp } from '../../src/shared/http/createApp.js';
import { createErrorHandler } from '../../src/shared/http/errorHandler.js';
import { attachAuthContext } from '../../src/shared/http/requestAuthContext.js';
import { createAuthContext } from '../../src/shared/kernel/AuthContext.js';
import { caseManagementErrorStatus } from '../../src/modules/case-management/infrastructure/adapters/inbound/http/errorStatus.js';
import { InMemoryPaymentActivityRepository } from '../helpers/risk-assessment/InMemoryPaymentActivityRepository.js';
import { InMemoryCaseRepository } from '../helpers/case-management/InMemoryCaseRepository.js';
import { ANCHOR, activity, hoursBefore } from '../helpers/risk-assessment/paymentActivityFixtures.js';
import { FixedClock } from '../helpers/FixedClock.js';
import { oid } from '../support/oid.js';

const ORG = oid('org-1');
const AUTH = createAuthContext({ userId: oid('analyst-1'), organizationId: ORG, actorType: 'USER', roleId: 'ANALYST' });
const HISTORY = { previousCases: 3, openCases: 1, fraudConfirmedCases: 1, falsePositiveCases: 0 };

function event(overrides: Record<string, unknown> = {}): CanonicalRiskEvent {
  return createCanonicalRiskEvent({
    provider: 'stripe',
    providerEventType: 'charge.failed',
    caseCustomerId: 'cus_1',
    amountCents: 100,
    currency: 'USD',
    riskSignals: {},
    createdAt: ANCHOR,
    ...overrides,
  });
}

function buildContext() {
  const activities = new InMemoryPaymentActivityRepository();
  const historyQueries: CustomerCaseHistoryQuery[] = [];
  const getCustomerPaymentActivity = createGetCustomerPaymentActivityUseCase({ activities });
  const getCustomerCaseHistory = createGetCustomerCaseHistoryUseCase({
    reader: {
      countByCustomer: async (query) => {
        historyQueries.push(query);
        return HISTORY;
      },
    },
  });
  const enrich = createCustomerRiskContextEnricher({ getCustomerPaymentActivity, getCustomerCaseHistory });
  return { activities, historyQueries, getCustomerPaymentActivity, getCustomerCaseHistory, enrich };
}

describe('createCustomerRiskContextEnricher', () => {
  it('fills activity and customerHistory anchored on the event time, replacing whatever the caller sent', async () => {
    const { activities, enrich } = buildContext();
    await activities.record(activity({ occurredAt: hoursBefore(1), outcome: 'FAILED', declineCategory: 'FRAUD_SUSPECTED' }));
    await activities.record(activity({ occurredAt: hoursBefore(2) }));
    // After the event: it did not exist yet when the event happened.
    await activities.record(activity({ occurredAt: hoursBefore(-2), outcome: 'FAILED' }));

    const enriched = await enrich({ auth: AUTH, event: event({ activity: { attempts24h: 0 } }) });

    expect(enriched.activity).toMatchObject({ attempts24h: 2, failedAttempts24h: 1, failureRate24h: 50, suspiciousDeclines24h: 1 });
    expect(enriched.customerHistory).toMatchObject({ ...HISTORY, lifetimeAttempts: 2 });
  });
});

describe('scoreToCaseOrchestrator with enrichment', () => {
  it('scores and freezes the enriched event', async () => {
    const { enrich } = buildContext();
    const scored: CanonicalRiskEvent[] = [];
    let snapshot: Record<string, unknown> | null = null;
    const process = createScoreToCaseOrchestrator({
      enrichEvent: enrich,
      calculateRiskScore: async (input) => {
        scored.push(input.event);
        return { riskScore: 90, ruleId: oid('rule-1'), name: 'r', conditionsVersion: 1, hits: [] } as unknown as CalculateRiskScoreResult;
      },
      getOrganizationFraudConfig: async () =>
        OrganizationFraudConfig.create({
          id: generateOrganizationFraudConfigId(),
          organizationId: ORG,
          slaLowMinutes: 240,
          slaMediumMinutes: 120,
          slaHighMinutes: 60,
          slaCriticalMinutes: 30,
          riskThresholdLow: 25,
          riskThresholdMedium: 50,
          riskThresholdHigh: 75,
          riskThresholdCritical: 90,
          featureFlags: {},
          now: ANCHOR,
        }),
      createCase: async (input) => {
        snapshot = input.finturuCacheSnapshot ?? null;
        return Case.create({ id: createCaseId(oid('case-1')), organizationId: ORG, customerId: 'cus_1', riskScore: createRiskScore(90), priority: 'CRITICAL', now: ANCHOR });
      },
    });

    await process({ auth: AUTH, event: event() });

    expect(scored[0]?.customerHistory).toMatchObject(HISTORY);
    expect((snapshot as unknown as { event: CanonicalRiskEvent }).event.customerHistory).toMatchObject(HISTORY);
  });
});

describe('webhookToScoreOrchestrator activity recording', () => {
  const INGEST_ID = generateProviderIngestEventId();

  function events(): ProviderIngestEventRepository {
    let row = ProviderIngestEvent.create({ id: INGEST_ID, organizationId: ORG, provider: 'stripe', providerEventId: 'evt_1', status: 'RECEIVED', now: ANCHOR });
    return {
      insertUnique: async () => 'inserted',
      save: async (next) => void (row = next),
      findByOrgProviderEvent: async () => row,
      findById: async () => row,
    };
  }

  function failedCharge(withActivity = true) {
    return createIngestedPaymentEvent({
      provider: 'stripe',
      providerEventType: 'charge.failed',
      caseCustomerId: 'cus_1',
      amountCents: 500,
      currency: 'usd',
      riskSignals: { declineCategory: 'AUTHENTICATION_FAILED', cardCountry: 'NG', billingCountry: 'US' },
      createdAt: ANCHOR,
      providerEventId: 'evt_1',
      ...(withActivity ? { paymentActivity: { kind: 'ATTEMPT', outcome: 'FAILED', providerReference: 'ch_9' } } : {}),
    });
  }

  it('records the attempt BEFORE scoring, so the rules count the event itself', async () => {
    const { activities, enrich } = buildContext();
    const seenAttempts: number[] = [];
    const composer = createWebhookToScoreOrchestrator({
      events: events(),
      clock: new FixedClock(ANCHOR),
      recordPaymentActivity: createRecordPaymentActivityUseCase({ activities, clock: new FixedClock(ANCHOR), generatePaymentActivityId }),
      processRiskScoreToCase: async (input) => {
        const enriched = await enrich(input);
        seenAttempts.push(enriched.activity?.attempts24h ?? -1);
        return { riskScore: 0, ruleId: 'r', conditionsVersion: 1, opened: false };
      },
    });

    await composer.compose({ organizationId: ORG, provider: 'stripe', event: failedCharge(), ingestEventId: INGEST_ID });

    expect(seenAttempts).toEqual([1]);
    expect(activities.all()[0]?.toProps()).toMatchObject({
      customerId: 'cus_1',
      providerReference: 'ch_9',
      outcome: 'FAILED',
      declineCategory: 'AUTHENTICATION_FAILED',
      cardCountry: 'NG',
      source: 'WEBHOOK',
    });
    expect(await createPaymentCustomerLookup(activities).findCustomerId(ORG, 'stripe', 'ch_9')).toBe('cus_1');
  });

  it('still scores when recording fails, and records nothing for events without activity', async () => {
    const errors: string[] = [];
    let scoredCount = 0;
    const composer = createWebhookToScoreOrchestrator({
      events: events(),
      clock: new FixedClock(ANCHOR),
      recordPaymentActivity: async () => {
        throw new Error('mongo down');
      },
      onError: (_error, ctx) => errors.push(ctx.stage),
      processRiskScoreToCase: async () => {
        scoredCount += 1;
        return { riskScore: 0, ruleId: 'r', conditionsVersion: 1, opened: false };
      },
    });

    await composer.compose({ organizationId: ORG, provider: 'stripe', event: failedCharge(), ingestEventId: INGEST_ID });

    expect(scoredCount).toBe(1);
    expect(errors).toEqual(['recordPaymentActivity']);

    const { activities } = buildContext();
    const quiet = createWebhookToScoreOrchestrator({
      events: events(),
      clock: new FixedClock(ANCHOR),
      recordPaymentActivity: createRecordPaymentActivityUseCase({ activities, clock: new FixedClock(ANCHOR), generatePaymentActivityId }),
      processRiskScoreToCase: async () => ({ riskScore: 0, ruleId: 'r', conditionsVersion: 1, opened: false }),
    });
    await quiet.compose({ organizationId: ORG, provider: 'stripe', event: failedCharge(false), ingestEventId: INGEST_ID });
    expect(activities.all()).toHaveLength(0);
  });
});

describe('GET /cases/:caseId/customer-activity', () => {
  async function buildApp(auth = AUTH) {
    const context = buildContext();
    const cases = new InMemoryCaseRepository();
    await cases.save(
      Case.create({
        id: createCaseId(oid('case-1')),
        organizationId: ORG,
        customerId: '4242',
        stripeCustomerId: 'cus_1',
        riskScore: createRiskScore(50),
        priority: 'MEDIUM',
        now: ANCHOR,
      }),
    );
    const router = caseCustomerActivityRouter({
      getCase: createGetCaseUseCase({ cases }),
      getCustomerPaymentActivity: context.getCustomerPaymentActivity,
      getCustomerCaseHistory: context.getCustomerCaseHistory,
      clock: new FixedClock(ANCHOR),
    });
    const mounted = Router();
    mounted.use((req: Request, _res: Response, next: NextFunction) => {
      attachAuthContext(req, auth);
      next();
    });
    mounted.use(router);
    const app = createApp({ routers: [{ path: '/api/v1', router: mounted }], errorHandler: createErrorHandler(caseManagementErrorStatus) });
    return { app, ...context };
  }

  it('returns the variables and recent payments for every id of the case customer, excluding the case itself', async () => {
    const { app, activities, historyQueries } = await buildApp();
    await activities.record(activity({ customerId: 'cus_1', occurredAt: hoursBefore(1) }));
    await activities.record(activity({ customerId: '4242', occurredAt: hoursBefore(2), outcome: 'FAILED' }));

    const response = await request(app).get(`/api/v1/cases/${oid('case-1')}/customer-activity`);

    expect(response.status).toBe(200);
    expect(response.body.customerIds).toEqual(['4242', 'cus_1']);
    expect(response.body.activity).toMatchObject({ attempts24h: 2, failedAttempts24h: 1 });
    expect(response.body.customerHistory).toMatchObject(HISTORY);
    expect(response.body.recent).toHaveLength(2);
    expect(historyQueries[0]).toMatchObject({ customerId: '4242', excludeCaseId: oid('case-1') });
  });

  it('answers 403 for a case of another organization', async () => {
    const { app } = await buildApp(
      createAuthContext({ userId: oid('x'), organizationId: oid('org-2'), actorType: 'USER', roleId: 'ANALYST' }),
    );

    const response = await request(app).get(`/api/v1/cases/${oid('case-1')}/customer-activity`);

    expect(response.status).toBe(403);
  });
});
