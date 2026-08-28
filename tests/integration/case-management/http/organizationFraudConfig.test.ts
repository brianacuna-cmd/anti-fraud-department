import { oid } from '../../../support/oid.js';
import { Router, type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { createApp } from '../../../../src/shared/http/createApp.js';
import { createErrorHandler } from '../../../../src/shared/http/errorHandler.js';
import { attachAuthContext } from '../../../../src/shared/http/requestAuthContext.js';
import { createAuthContext, type AuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { caseManagementErrorStatus } from '../../../../src/modules/case-management/infrastructure/adapters/inbound/http/errorStatus.js';
import { organizationFraudConfigRouter } from '../../../../src/modules/case-management/infrastructure/adapters/inbound/http/organizationFraudConfigRouter.js';
import { createGetOrganizationFraudConfigUseCase } from '../../../../src/modules/case-management/application/GetOrganizationFraudConfig.js';
import { createUpsertOrganizationFraudConfigUseCase } from '../../../../src/modules/case-management/application/UpsertOrganizationFraudConfig.js';
import { InMemoryOrganizationFraudConfigRepository } from '../../../helpers/case-management/InMemoryOrganizationFraudConfigRepository.js';
import { InMemoryCaseManagementAuditRecorder } from '../../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';
import { InMemoryUnitOfWork } from '../../../helpers/case-management/InMemoryUnitOfWork.js';
import { OrganizationFraudConfig } from '../../../../src/modules/case-management/domain/model/aggregates/OrganizationFraudConfig.js';
import { createOrganizationFraudConfigId } from '../../../../src/modules/case-management/domain/model/value-objects/OrganizationFraudConfigId.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const SECRET = 'whsec_do-not-leak-this-secret-value!!';
const WEBHOOK_URL = 'https://hooks.example.com/fraud';
const CANONICAL_PATH = '/api/v1/organization-fraud-config';

const ORG_1_USER = createAuthContext({
  userId: oid('user-1'),
  organizationId: oid('org-1'),
  actorType: 'USER',
  roleId: 'SUPERVISOR',
  ipAddress: '10.0.0.1',
});

const FULL_BODY = {
  slaLowMinutes: 240,
  slaMediumMinutes: 120,
  slaHighMinutes: 60,
  slaCriticalMinutes: 30,
  riskThresholdLow: 25,
  riskThresholdMedium: 50,
  riskThresholdHigh: 75,
  riskThresholdCritical: 90,
  featureFlags: { autoRouting: true },
};

const MONETARY_LIMIT_KEYS = [
  'dailyLimit',
  'monetaryLimit',
  'transactionLimit',
  'maxAmount',
  'amountLimit',
] as const;

function buildApp(actorPerRequest: () => AuthContext = () => ORG_1_USER) {
  const repository = new InMemoryOrganizationFraudConfigRepository();
  const auditRecorder = new InMemoryCaseManagementAuditRecorder();
  const unitOfWork = new InMemoryUnitOfWork();
  const clock = new FixedClock(NOW);
  const router = organizationFraudConfigRouter({
    getOrganizationFraudConfig: createGetOrganizationFraudConfigUseCase({ repository }),
    upsertOrganizationFraudConfig: createUpsertOrganizationFraudConfigUseCase({
      repository,
      clock,
      auditRecorder,
      unitOfWork,
    }),
  });

  function testAuthMiddleware(req: Request, _res: Response, next: NextFunction): void {
    attachAuthContext(req, actorPerRequest());
    next();
  }

  const mounted = Router();
  mounted.use(testAuthMiddleware);
  mounted.use(router);

  const app = createApp({
    routers: [{ path: '/api/v1', router: mounted }],
    errorHandler: createErrorHandler(caseManagementErrorStatus),
  });

  return { app, repository, auditRecorder };
}

describe('organizationFraudConfigRouter', () => {
  it('PUT then GET returns the stored config with SLA values', async () => {
    const { app } = buildApp();

    const put = await request(app).put(CANONICAL_PATH).send(FULL_BODY);
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({
      organizationId: oid('org-1'),
      slaLowMinutes: 240,
      slaHighMinutes: 60,
      slaCriticalMinutes: 30,
      riskThresholdCritical: 90,
      featureFlags: { autoRouting: true },
    });

    const get = await request(app).get(CANONICAL_PATH);
    expect(get.status).toBe(200);
    expect(get.body).toMatchObject({
      organizationId: oid('org-1'),
      slaLowMinutes: 240,
      slaMediumMinutes: 120,
      slaHighMinutes: 60,
      slaCriticalMinutes: 30,
      outboundWebhookUrl: null,
    });
  });

  it('PUT persists optional outboundWebhookUrl and GET returns it', async () => {
    const { app } = buildApp();

    const put = await request(app)
      .put(CANONICAL_PATH)
      .send({ ...FULL_BODY, outboundWebhookUrl: WEBHOOK_URL });
    expect(put.status).toBe(200);
    expect(put.body.outboundWebhookUrl).toBe(WEBHOOK_URL);

    const get = await request(app).get(CANONICAL_PATH);
    expect(get.status).toBe(200);
    expect(get.body.outboundWebhookUrl).toBe(WEBHOOK_URL);
  });

  it('PUT that changes only SLA minutes preserves other fields on GET', async () => {
    const { app, repository } = buildApp();
    repository.seed(
      OrganizationFraudConfig.create({
        id: createOrganizationFraudConfigId(oid('config-1')),
        organizationId: oid('org-1'),
        slaLowMinutes: 240,
        slaMediumMinutes: 120,
        slaHighMinutes: 60,
        slaCriticalMinutes: 30,
        riskThresholdLow: 25,
        riskThresholdMedium: 50,
        riskThresholdHigh: 75,
        riskThresholdCritical: 90,
        featureFlags: { autoRouting: true },
        now: NOW,
      }),
    );

    const put = await request(app)
      .put(CANONICAL_PATH)
      .send({
        ...FULL_BODY,
        slaLowMinutes: 10,
        slaMediumMinutes: 20,
        slaHighMinutes: 30,
        slaCriticalMinutes: 5,
      });
    expect(put.status).toBe(200);

    const get = await request(app).get(CANONICAL_PATH);
    expect(get.status).toBe(200);
    expect(get.body).toMatchObject({
      slaLowMinutes: 10,
      slaMediumMinutes: 20,
      slaHighMinutes: 30,
      slaCriticalMinutes: 5,
      riskThresholdLow: 25,
      riskThresholdMedium: 50,
      riskThresholdHigh: 75,
      riskThresholdCritical: 90,
      featureFlags: { autoRouting: true },
    });
  });

  it('GET returns 404 ORGANIZATION_FRAUD_CONFIG_NOT_FOUND when no config exists', async () => {
    const { app } = buildApp();

    const response = await request(app).get(CANONICAL_PATH);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('ORGANIZATION_FRAUD_CONFIG_NOT_FOUND');
  });

  it('PUT 200 writes one UPSERT audit event for the config id', async () => {
    const { app, auditRecorder } = buildApp();

    const put = await request(app).put(CANONICAL_PATH).send(FULL_BODY);
    expect(put.status).toBe(200);
    expect(auditRecorder.all()).toHaveLength(1);
    expect(auditRecorder.all()[0]).toMatchObject({
      action: 'UPSERT_ORGANIZATION_FRAUD_CONFIG',
      resource: 'organization_fraud_config',
      resourceId: put.body.id,
      organizationId: oid('org-1'),
      detail: expect.objectContaining({
        slaLowMinutes: 240,
        slaMediumMinutes: 120,
        slaHighMinutes: 60,
        slaCriticalMinutes: 30,
        riskThresholdLow: 25,
        riskThresholdMedium: 50,
        riskThresholdHigh: 75,
        riskThresholdCritical: 90,
        featureFlags: { autoRouting: true },
        outboundWebhookUrlSet: false,
        outboundWebhookSecretSet: false,
      }),
    });
  });

  it('GET 200 and GET 404 do not increment audit_logs', async () => {
    const missing = buildApp();
    const missingGet = await request(missing.app).get(CANONICAL_PATH);
    expect(missingGet.status).toBe(404);
    expect(missing.auditRecorder.all()).toHaveLength(0);

    const { app, auditRecorder } = buildApp();
    await request(app).put(CANONICAL_PATH).send(FULL_BODY).expect(200);
    expect(auditRecorder.all()).toHaveLength(1);

    const get = await request(app).get(CANONICAL_PATH);
    expect(get.status).toBe(200);
    expect(auditRecorder.all()).toHaveLength(1);
  });

  it('audit detail omits outboundWebhookSecret and the submitted secret value', async () => {
    const { app, auditRecorder } = buildApp();

    const put = await request(app)
      .put(CANONICAL_PATH)
      .send({ ...FULL_BODY, outboundWebhookUrl: WEBHOOK_URL, outboundWebhookSecret: SECRET });
    expect(put.status).toBe(200);
    expect(put.body.outboundWebhookSecretSet).toBe(true);
    expect(put.body).not.toHaveProperty('outboundWebhookSecret');

    const [event] = auditRecorder.all();
    expect(event.detail).toMatchObject({
      outboundWebhookUrlSet: true,
      outboundWebhookSecretSet: true,
    });
    expect('outboundWebhookSecret' in event.detail).toBe(false);
    expect('outboundWebhookUrl' in event.detail).toBe(false);
    expect(JSON.stringify(event.detail)).not.toContain(SECRET);
  });

  it('serves GET and PUT on the canonical path and not on a nested organization path', async () => {
    const { app } = buildApp();

    await request(app).put(CANONICAL_PATH).send(FULL_BODY).expect(200);
    await request(app).get(CANONICAL_PATH).expect(200);

    const nestedUnderApi = await request(app).get(`/api/v1/organizations/${oid('org-1')}/fraud-config`);
    expect(nestedUnderApi.status).toBe(404);

    const nestedPut = await request(app)
      .put(`/api/v1/organizations/${oid('org-1')}/fraud-config`)
      .send(FULL_BODY);
    expect(nestedPut.status).toBe(404);

    const nestedBare = await request(app).get(`/organizations/${oid('org-1')}/fraud-config`);
    expect(nestedBare.status).toBe(404);
  });

  it('allows ANALYST GET on the canonical path without writing audit', async () => {
    let actor = ORG_1_USER;
    const { app, auditRecorder } = buildApp(() => actor);
    await request(app).put(CANONICAL_PATH).send(FULL_BODY).expect(200);
    expect(auditRecorder.all()).toHaveLength(1);

    actor = createAuthContext({
      userId: oid('user-1'),
      organizationId: oid('org-1'),
      roleId: 'ANALYST',
    });
    const get = await request(app).get(CANONICAL_PATH);
    expect(get.status).toBe(200);
    expect(get.body.organizationId).toBe(oid('org-1'));
    expect(auditRecorder.all()).toHaveLength(1);
  });

  it('rejects non-SUPERVISOR PUT with 403 and no upsert or audit', async () => {
    for (const roleId of ['ANALYST', 'ADMIN', 'AUDITOR'] as const) {
      const { app, repository, auditRecorder } = buildApp(() =>
        createAuthContext({
          userId: oid('user-1'),
          organizationId: oid('org-1'),
          roleId,
        }),
      );

      const put = await request(app).put(CANONICAL_PATH).send(FULL_BODY);
      expect(put.status).toBe(403);
      expect(put.body.error.code).toBe('FORBIDDEN_ROLE');
      expect(await repository.findByOrganization(oid('org-1'))).toBeNull();
      expect(auditRecorder.all()).toHaveLength(0);
    }
  });

  it('rejects a monetary-limit field on PUT and GET JSON has none of those properties', async () => {
    const { app, repository, auditRecorder } = buildApp();

    const put = await request(app)
      .put(CANONICAL_PATH)
      .send({ ...FULL_BODY, dailyLimit: 1000, monetaryLimit: 500 });
    expect(put.status).toBe(400);
    expect(put.body.error.code).toBe('INVARIANT_VIOLATION');
    expect(await repository.findByOrganization(oid('org-1'))).toBeNull();
    expect(auditRecorder.all()).toHaveLength(0);

    await request(app).put(CANONICAL_PATH).send(FULL_BODY).expect(200);
    const get = await request(app).get(CANONICAL_PATH).expect(200);
    for (const key of MONETARY_LIMIT_KEYS) {
      expect(get.body).not.toHaveProperty(key);
    }
    expect(get.body).toMatchObject({
      featureFlags: { autoRouting: true },
      outboundWebhookUrl: null,
      outboundWebhookSecretSet: false,
    });
  });

  it('retains extras: featureFlags, webhook URL, and write-only secret presence', async () => {
    const { app } = buildApp();

    const put = await request(app)
      .put(CANONICAL_PATH)
      .send({
        ...FULL_BODY,
        featureFlags: { autoRouting: true, notifyOps: false },
        outboundWebhookUrl: WEBHOOK_URL,
        outboundWebhookSecret: SECRET,
      });
    expect(put.status).toBe(200);
    expect(put.body.featureFlags).toEqual({ autoRouting: true, notifyOps: false });
    expect(put.body.outboundWebhookUrl).toBe(WEBHOOK_URL);
    expect(put.body.outboundWebhookSecretSet).toBe(true);
    expect(put.body).not.toHaveProperty('outboundWebhookSecret');

    const get = await request(app).get(CANONICAL_PATH).expect(200);
    expect(get.body.featureFlags).toEqual({ autoRouting: true, notifyOps: false });
    expect(get.body.outboundWebhookUrl).toBe(WEBHOOK_URL);
    expect(get.body.outboundWebhookSecretSet).toBe(true);
    expect(get.body).not.toHaveProperty('outboundWebhookSecret');
  });
});
