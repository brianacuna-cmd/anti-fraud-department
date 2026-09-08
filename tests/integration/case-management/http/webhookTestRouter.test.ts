import { oid } from '../../../support/oid.js';
import { Router, type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { createApp } from '../../../../src/shared/http/createApp.js';
import { createErrorHandler } from '../../../../src/shared/http/errorHandler.js';
import { attachAuthContext } from '../../../../src/shared/http/requestAuthContext.js';
import { createAuthContext, type AuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { caseManagementErrorStatus } from '../../../../src/modules/case-management/infrastructure/adapters/inbound/http/errorStatus.js';
import { webhookTestRouter } from '../../../../src/modules/case-management/infrastructure/adapters/inbound/http/webhookTestRouter.js';
import { createTestOutgoingWebhookUseCase } from '../../../../src/modules/case-management/application/TestOutgoingWebhook.js';
import { OrganizationFraudConfig } from '../../../../src/modules/case-management/domain/model/aggregates/OrganizationFraudConfig.js';
import { createOrganizationFraudConfigId } from '../../../../src/modules/case-management/domain/model/value-objects/OrganizationFraudConfigId.js';
import { generateCustomerOutgoingEventId } from '../../../../src/modules/case-management/domain/model/value-objects/CustomerOutgoingEventId.js';
import { InMemoryOrganizationFraudConfigRepository } from '../../../helpers/case-management/InMemoryOrganizationFraudConfigRepository.js';
import { InMemoryCustomerOutgoingEventRepository } from '../../../helpers/case-management/InMemoryCustomerOutgoingEventRepository.js';
import { InMemoryCaseManagementAuditRecorder } from '../../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';
import { InMemoryUnitOfWork } from '../../../helpers/case-management/InMemoryUnitOfWork.js';
import { FakeOutgoingWebhookClient } from '../../../helpers/case-management/FakeOutgoingWebhookClient.js';
import { FixedClock } from '../../../helpers/FixedClock.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG = oid('org-1');
const URL_A = 'https://hooks.example.com/a';

function supervisor(organizationId = ORG): AuthContext {
  return createAuthContext({
    userId: oid('user-1'),
    organizationId,
    roleId: 'SUPERVISOR',
  });
}

function seedConfig(
  fraudConfigs: InMemoryOrganizationFraudConfigRepository,
  outboundWebhookUrl: string | null,
) {
  fraudConfigs.seed(
    OrganizationFraudConfig.create({
      id: createOrganizationFraudConfigId(oid('config-1')),
      organizationId: ORG,
      slaLowMinutes: 240,
      slaMediumMinutes: 120,
      slaHighMinutes: 60,
      slaCriticalMinutes: 30,
      riskThresholdLow: 25,
      riskThresholdMedium: 50,
      riskThresholdHigh: 75,
      riskThresholdCritical: 90,
      outboundWebhookUrl,
      outboundWebhookSecret: 'hmac-secret',
      now: NOW,
    }),
  );
}

function buildApp(actorPerRequest: () => AuthContext, options: { readonly seedUrl?: string | null } = {}) {
  const fraudConfigs = new InMemoryOrganizationFraudConfigRepository();
  const outgoingEvents = new InMemoryCustomerOutgoingEventRepository();
  const auditRecorder = new InMemoryCaseManagementAuditRecorder();
  const webhookClient = new FakeOutgoingWebhookClient();
  seedConfig(fraudConfigs, options.seedUrl === undefined ? URL_A : options.seedUrl);

  const api = Router();
  api.use((req: Request, _res: Response, next: NextFunction) => {
    attachAuthContext(req, actorPerRequest());
    next();
  });
  api.use(
    webhookTestRouter({
      testOutgoingWebhook: createTestOutgoingWebhookUseCase({
        fraudConfig: fraudConfigs,
        webhookClient,
        outgoingEvents,
        auditRecorder,
        unitOfWork: new InMemoryUnitOfWork(),
        clock: new FixedClock(NOW),
        generateCustomerOutgoingEventId,
      }),
    }),
  );

  return {
    app: createApp({
      routers: [{ path: '/api/v1', router: api }],
      errorHandler: createErrorHandler({
        UNAUTHENTICATED: 401,
        ...caseManagementErrorStatus,
      }),
    }),
    outgoingEvents,
    auditRecorder,
    webhookClient,
  };
}

function buildUnauthenticatedApp() {
  const api = Router();
  api.use(
    webhookTestRouter({
      testOutgoingWebhook: createTestOutgoingWebhookUseCase({
        fraudConfig: new InMemoryOrganizationFraudConfigRepository(),
        webhookClient: new FakeOutgoingWebhookClient(),
        outgoingEvents: new InMemoryCustomerOutgoingEventRepository(),
        auditRecorder: new InMemoryCaseManagementAuditRecorder(),
        unitOfWork: new InMemoryUnitOfWork(),
        clock: new FixedClock(NOW),
        generateCustomerOutgoingEventId,
      }),
    }),
  );
  return createApp({
    routers: [{ path: '/api/v1', router: api }],
    errorHandler: createErrorHandler({
      UNAUTHENTICATED: 401,
      ...caseManagementErrorStatus,
    }),
  });
}

describe('webhookTestRouter (HTTP)', () => {
  it('POST /webhooks/test returns 200 envelope SENT and audit for SUPERVISOR', async () => {
    const { app, outgoingEvents, auditRecorder, webhookClient } = buildApp(() => supervisor());

    const response = await request(app).post('/api/v1/webhooks/test').send({}).expect(200);

    expect(response.body).toEqual({
      statusCode: 200,
      latencyMs: expect.any(Number),
      ok: true,
      eventId: response.body.eventId,
    });
    expect(outgoingEvents.all()[0]!.status).toBe('SENT');
    expect(auditRecorder.all()[0]).toMatchObject({
      action: 'WEBHOOK_TEST',
      resource: 'outgoing_webhook',
      resourceId: response.body.eventId,
    });
    expect(webhookClient.posts[0]!.url).toBe(URL_A);
  });

  it('rejects ANALYST with 403 and does not POST or persist', async () => {
    const { app, outgoingEvents, webhookClient } = buildApp(() =>
      createAuthContext({
        userId: oid('user-1'),
        organizationId: ORG,
        roleId: 'ANALYST',
      }),
    );

    await request(app).post('/api/v1/webhooks/test').send({}).expect(403);
    expect(webhookClient.posts).toHaveLength(0);
    expect(outgoingEvents.all()).toHaveLength(0);
  });

  it('returns 401 when no auth context is attached', async () => {
    const app = buildUnauthenticatedApp();
    const res = await request(app).post('/api/v1/webhooks/test').send({});
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a body url with 400 and does not POST (SSRF)', async () => {
    const { app, outgoingEvents, webhookClient } = buildApp(() => supervisor());

    await request(app)
      .post('/api/v1/webhooks/test')
      .send({ url: 'https://evil.example/hook' })
      .expect(400);
    expect(webhookClient.posts).toHaveLength(0);
    expect(outgoingEvents.all()).toHaveLength(0);
  });

  it('rejects extra JSON keys with 400', async () => {
    const { app, webhookClient } = buildApp(() => supervisor());

    await request(app).post('/api/v1/webhooks/test').send({ extra: true }).expect(400);
    expect(webhookClient.posts).toHaveLength(0);
  });

  it('returns 422 OUTBOUND_WEBHOOK_URL_NOT_SET when URL is missing', async () => {
    const { app, outgoingEvents, webhookClient } = buildApp(() => supervisor(), { seedUrl: null });

    const res = await request(app).post('/api/v1/webhooks/test').send({}).expect(422);
    expect(res.body.error.code).toBe('OUTBOUND_WEBHOOK_URL_NOT_SET');
    expect(webhookClient.posts).toHaveLength(0);
    expect(outgoingEvents.all()).toHaveLength(0);
  });
});
