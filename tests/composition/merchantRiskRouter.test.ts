import { Router, type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { merchantRiskRouter, type FinturuMerchantSource } from '../../src/composition/merchantRiskRouter.js';
import { createGetCustomerCaseHistoryUseCase } from '../../src/modules/case-management/application/GetCustomerCaseHistory.js';
import {
  FinturuApiClient,
  FinturuUnavailableError,
  type FinturuMerchantDto,
  type FinturuPaymentLinkDto,
} from '../../src/modules/case-management/infrastructure/adapters/outbound/finturu/FinturuApiClient.js';
import { paymentActivityImportRouter } from '../../src/modules/risk-assessment/infrastructure/adapters/inbound/http/paymentActivityImportRouter.js';
import { createImportPaymentActivitiesUseCase } from '../../src/modules/risk-assessment/application/ImportPaymentActivities.js';
import { generatePaymentActivityId } from '../../src/modules/risk-assessment/domain/model/value-objects/PaymentActivityId.js';
import { riskAssessmentErrorStatus } from '../../src/modules/risk-assessment/infrastructure/adapters/inbound/http/errorStatus.js';
import { createApp } from '../../src/shared/http/createApp.js';
import { createErrorHandler } from '../../src/shared/http/errorHandler.js';
import { attachAuthContext } from '../../src/shared/http/requestAuthContext.js';
import { createAuthContext, type AuthContext } from '../../src/shared/kernel/AuthContext.js';
import { InMemoryPaymentActivityRepository } from '../helpers/risk-assessment/InMemoryPaymentActivityRepository.js';
import { InMemoryRiskAssessmentAuditRecorder } from '../helpers/risk-assessment/InMemoryRiskAssessmentAuditRecorder.js';
import { ANCHOR, activity, hoursBefore } from '../helpers/risk-assessment/paymentActivityFixtures.js';
import { FixedClock } from '../helpers/FixedClock.js';
import { oid } from '../support/oid.js';

const ORG = oid('org-1');
const ANALYST = createAuthContext({ userId: oid('an'), organizationId: ORG, actorType: 'USER', roleId: 'ANALYST' });
const SUPERVISOR = createAuthContext({ userId: oid('sup'), organizationId: ORG, actorType: 'USER', roleId: 'SUPERVISOR' });

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

function link(overrides: Partial<FinturuPaymentLinkDto>): FinturuPaymentLinkDto {
  return {
    id: 1,
    userId: 42,
    description: null,
    amount: 100,
    shippingAmount: 0,
    fee: null,
    currency: 'USD',
    state: 'PAID',
    isPaid: true,
    provider: 'stripe',
    providerPaymentId: 'pi_1',
    reference: null,
    orderId: null,
    refundAmount: null,
    refundDate: null,
    createdAt: '2026-03-01T00:00:00.000Z',
    dueDate: null,
    ...overrides,
  };
}

function buildApp(options: { auth?: AuthContext; finturu?: Partial<FinturuMerchantSource> } = {}) {
  const activities = new InMemoryPaymentActivityRepository();
  const audit = new InMemoryRiskAssessmentAuditRecorder();
  const linkQueries: unknown[] = [];
  const finturu: FinturuMerchantSource = {
    listMerchants: async () => ({ items: [MERCHANT], total: 1 }),
    getMerchant: async (userId) => (userId === 42 ? MERCHANT : null),
    listPaymentLinks: async (query) => {
      linkQueries.push(query);
      return { items: [link({ id: 1 }), link({ id: 2, providerPaymentId: 'pi_missing' })], total: 2 };
    },
    ...options.finturu,
  };
  const mounted = Router();
  mounted.use((req: Request, _res: Response, next: NextFunction) => {
    attachAuthContext(req, options.auth ?? ANALYST);
    next();
  });
  mounted.use(
    merchantRiskRouter({
      finturu,
      activities,
      getCustomerCaseHistory: createGetCustomerCaseHistoryUseCase({
        reader: { countByCustomer: async () => ({ previousCases: 2, openCases: 1, fraudConfirmedCases: 1, falsePositiveCases: 0 }) },
      }),
      clock: new FixedClock(ANCHOR),
    }),
  );
  mounted.use(
    paymentActivityImportRouter({
      importPaymentActivities: createImportPaymentActivitiesUseCase({
        activities,
        auditRecorder: audit,
        clock: new FixedClock(ANCHOR),
        generatePaymentActivityId,
      }),
    }),
  );
  const app = createApp({ routers: [{ path: '/api/v1', router: mounted }], errorHandler: createErrorHandler(riskAssessmentErrorStatus) });
  return { app, activities, audit, linkQueries };
}

describe('GET /merchants', () => {
  it('returns Finturu merchants with activity received by any of their ids, cases and an explained risk', async () => {
    const { app, activities } = buildApp();
    await activities.record(activity({ merchantId: 'acct_ana', kind: 'CHARGEBACK', outcome: null, occurredAt: hoursBefore(5) }));
    await activities.record(activity({ merchantId: '42', occurredAt: hoursBefore(6) }));

    const response = await request(app).get('/api/v1/merchants?limit=10');

    expect(response.status).toBe(200);
    expect(response.body.total).toBe(1);
    const [merchant] = response.body.items;
    expect(merchant.activity).toMatchObject({ attempts90d: 1, chargebacks90d: 1 });
    expect(merchant.risk.factors.map((f: { code: string }) => f.code)).toEqual(['CHARGEBACKS', 'FRAUD_CONFIRMED_CASES', 'OPEN_CASES']);
    expect(merchant.risk).toMatchObject({ score: 60, level: 'HIGH' });
  });

  it('answers 404 for an unknown merchant and 502 when Finturu fails, never an empty list', async () => {
    expect((await request(buildApp().app).get('/api/v1/merchants/7')).status).toBe(404);

    const down = buildApp({
      finturu: {
        listMerchants: async () => {
          throw new FinturuUnavailableError('/merchants', 500);
        },
      },
    });
    const response = await request(down.app).get('/api/v1/merchants');
    expect(response.status).toBe(502);
    expect(response.body.error.code).toBe('FINTURU_UNAVAILABLE');
  });
});

describe('GET /reconciliation/payment-links', () => {
  it('reconciles the period and lists only the discrepancies', async () => {
    const { app, activities, linkQueries } = buildApp();
    await activities.record(activity({ providerReference: 'ch_1', relatedReferences: ['pi_1'], amountCents: 10_000 }));

    const response = await request(app).get('/api/v1/reconciliation/payment-links?from=2026-03-01&to=2026-04-01&userId=42');

    expect(response.status).toBe(200);
    expect(response.body.totals).toMatchObject({ MATCHED: 1, PAID_WITHOUT_PROVIDER_PAYMENT: 1 });
    expect(response.body.discrepancies).toHaveLength(1);
    expect(linkQueries[0]).toMatchObject({ userId: 42, from: '2026-03-01T00:00:00.000Z', to: '2026-04-01T00:00:00.000Z', offset: 0 });
  });

  it('downloads the discrepancies as CSV', async () => {
    const { app } = buildApp();

    const response = await request(app).get('/api/v1/reconciliation/payment-links?from=2026-03-01&to=2026-04-01&format=csv');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain('conciliacion-2026-03-01-2026-04-01.csv');
    const lines = response.text.trim().split('\n');
    expect(lines[0]).toContain('link_id,merchant_user_id,status');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('PAID_WITHOUT_PROVIDER_PAYMENT');
  });

  it('rejects bad periods and periods too large to reconcile synchronously', async () => {
    const tooMany = buildApp({ finturu: { listPaymentLinks: async () => ({ items: [], total: 50_000 }) } });

    expect((await request(tooMany.app).get('/api/v1/reconciliation/payment-links?from=2026-04-01&to=2026-03-01')).status).toBe(400);
    expect((await request(tooMany.app).get('/api/v1/reconciliation/payment-links?from=ayer&to=2026-03-01')).status).toBe(400);
    expect((await request(tooMany.app).get('/api/v1/reconciliation/payment-links?from=2026-01-01&to=2026-03-01')).status).toBe(400);
  });

  it('is not available to roles outside the investigation read set', async () => {
    const { app } = buildApp({
      auth: createAuthContext({ userId: oid('x'), organizationId: ORG, actorType: 'USER', roleId: 'VIEWER' }),
    });

    expect((await request(app).get('/api/v1/merchants')).status).toBe(403);
  });
});

describe('POST /payment-activities/import', () => {
  const CSV = [
    'provider,customer_id,kind,amount,currency,occurred_at,outcome,provider_reference',
    'stripe,cus_1,ATTEMPT,10.00,USD,2026-03-01T10:00:00Z,SUCCEEDED,ch_1',
    'stripe,cus_1,ATTEMPT,no-number,USD,2026-03-01T10:00:00Z,FAILED,ch_2',
  ].join('\n');

  it('imports a multipart CSV and reports per row', async () => {
    const { app, activities } = buildApp({ auth: SUPERVISOR });

    const response = await request(app)
      .post('/api/v1/payment-activities/import')
      .attach('file', Buffer.from(`﻿${CSV}`, 'utf8'), { filename: 'export.csv', contentType: 'text/csv' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ rowsRead: 2, inserted: 1, rejected: 1, errors: [{ line: 3 }] });
    expect(activities.all()).toHaveLength(1);
  });

  it('refuses a file without the required columns or without a file', async () => {
    const { app } = buildApp({ auth: SUPERVISOR });

    const noColumns = await request(app)
      .post('/api/v1/payment-activities/import')
      .attach('file', Buffer.from('customer,amount\ncus_1,10.00'), { filename: 'x.csv', contentType: 'text/csv' });
    const noFile = await request(app).post('/api/v1/payment-activities/import');

    expect(noColumns.status).toBe(400);
    expect(noColumns.body.error.message).toContain('provider');
    expect(noFile.status).toBe(400);
  });
});

describe('FinturuApiClient strict reads', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function respond(status: number, body: unknown) {
    globalThis.fetch = (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
  }

  it('returns null for an unknown merchant but throws on any other failure', async () => {
    const client = new FinturuApiClient({ baseUrl: 'http://finturu.test/api/v1/fraud-department' });

    respond(404, {});
    expect(await client.getMerchant(1)).toBeNull();

    respond(500, {});
    await expect(client.listMerchants(10, 0)).rejects.toBeInstanceOf(FinturuUnavailableError);

    respond(200, { items: [], total: 0 });
    expect(await client.listPaymentLinks({ limit: 10, offset: 0 })).toEqual({ items: [], total: 0 });

    globalThis.fetch = (async () => {
      throw new Error('ECONNREFUSED');
    }) as typeof fetch;
    await expect(client.listPaymentLinks({ limit: 10, offset: 0 })).rejects.toBeInstanceOf(FinturuUnavailableError);
  });
});
