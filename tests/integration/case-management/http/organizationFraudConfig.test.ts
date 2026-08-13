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
import { OrganizationFraudConfig } from '../../../../src/modules/case-management/domain/model/aggregates/OrganizationFraudConfig.js';
import { createOrganizationFraudConfigId } from '../../../../src/modules/case-management/domain/model/value-objects/OrganizationFraudConfigId.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_1_USER = createAuthContext({ userId: oid('user-1'), organizationId: oid('org-1') });

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

function buildApp(actorPerRequest: () => AuthContext = () => ORG_1_USER) {
  const repository = new InMemoryOrganizationFraudConfigRepository();
  const clock = new FixedClock(NOW);
  const router = organizationFraudConfigRouter({
    getOrganizationFraudConfig: createGetOrganizationFraudConfigUseCase({ repository }),
    upsertOrganizationFraudConfig: createUpsertOrganizationFraudConfigUseCase({ repository, clock }),
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

  return { app, repository };
}

describe('organizationFraudConfigRouter', () => {
  it('PUT then GET returns the stored config with SLA values', async () => {
    const { app } = buildApp();

    const put = await request(app).put('/api/v1/organization-fraud-config').send(FULL_BODY);
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({
      organizationId: oid('org-1'),
      slaLowMinutes: 240,
      slaHighMinutes: 60,
      slaCriticalMinutes: 30,
      riskThresholdCritical: 90,
      featureFlags: { autoRouting: true },
    });

    const get = await request(app).get('/api/v1/organization-fraud-config');
    expect(get.status).toBe(200);
    expect(get.body).toMatchObject({
      organizationId: oid('org-1'),
      slaLowMinutes: 240,
      slaMediumMinutes: 120,
      slaHighMinutes: 60,
      slaCriticalMinutes: 30,
    });
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
      .put('/api/v1/organization-fraud-config')
      .send({
        ...FULL_BODY,
        slaLowMinutes: 10,
        slaMediumMinutes: 20,
        slaHighMinutes: 30,
        slaCriticalMinutes: 5,
      });
    expect(put.status).toBe(200);

    const get = await request(app).get('/api/v1/organization-fraud-config');
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

    const response = await request(app).get('/api/v1/organization-fraud-config');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('ORGANIZATION_FRAUD_CONFIG_NOT_FOUND');
  });
});
