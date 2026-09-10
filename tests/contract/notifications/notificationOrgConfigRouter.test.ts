import { oid } from '../../support/oid.js';
import { Router, type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { createApp } from '../../../src/shared/http/createApp.js';
import { createErrorHandler } from '../../../src/shared/http/errorHandler.js';
import { attachAuthContext } from '../../../src/shared/http/requestAuthContext.js';
import { createAuthContext, type AuthContext } from '../../../src/shared/kernel/AuthContext.js';
import { notificationsErrorStatus } from '../../../src/modules/notifications/infrastructure/adapters/inbound/http/errorStatus.js';
import { notificationOrgConfigRouter } from '../../../src/modules/notifications/infrastructure/adapters/inbound/http/notificationOrgConfigRouter.js';
import { createGetNotificationOrgConfigUseCase } from '../../../src/modules/notifications/application/GetNotificationOrgConfig.js';
import { createUpsertNotificationOrgConfigUseCase } from '../../../src/modules/notifications/application/UpsertNotificationOrgConfig.js';
import { InMemoryNotificationOrgConfigRepository } from '../../helpers/notifications/InMemoryNotificationOrgConfigRepository.js';
import { InMemoryUnitOfWork } from '../../helpers/notifications/InMemoryUnitOfWork.js';
import { InMemoryAuditRecorder } from '../../helpers/notifications/InMemoryAuditRecorder.js';
import { FixedClock } from '../../helpers/FixedClock.js';
import { fromDate } from '../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const CANONICAL_PATH = '/api/v1/notification-org-config';

const SUPERVISOR_ORG_1 = createAuthContext({
  userId: oid('user-1'),
  organizationId: oid('org-1'),
  actorType: 'USER',
  roleId: 'SUPERVISOR',
});
const ANALYST_ORG_1 = createAuthContext({
  userId: oid('user-2'),
  organizationId: oid('org-1'),
  actorType: 'USER',
  roleId: 'ANALYST',
});

function buildApp(actorPerRequest: (() => AuthContext) | null = () => SUPERVISOR_ORG_1) {
  const repository = new InMemoryNotificationOrgConfigRepository();
  const auditRecorder = new InMemoryAuditRecorder();
  const unitOfWork = new InMemoryUnitOfWork();
  const clock = new FixedClock(NOW);
  const router = notificationOrgConfigRouter({
    getNotificationOrgConfig: createGetNotificationOrgConfigUseCase({ repository, clock }),
    upsertNotificationOrgConfig: createUpsertNotificationOrgConfigUseCase({
      repository,
      clock,
      auditRecorder,
      unitOfWork,
    }),
  });

  function testAuthMiddleware(req: Request, _res: Response, next: NextFunction): void {
    if (actorPerRequest) {
      attachAuthContext(req, actorPerRequest());
    }
    next();
  }

  const mounted = Router();
  mounted.use(testAuthMiddleware);
  mounted.use(router);

  const app = createApp({
    routers: [{ path: '/api/v1', router: mounted }],
    errorHandler: createErrorHandler(notificationsErrorStatus),
  });

  return { app, repository, auditRecorder };
}

describe('notificationOrgConfigRouter', () => {
  it('GET returns 200 with an empty default when no config exists', async () => {
    const { app } = buildApp();

    const response = await request(app).get(CANONICAL_PATH);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ webhookUrl: null, secretSet: false });
  });

  it('PUT then GET returns the stored webhookUrl', async () => {
    const { app } = buildApp();

    const put = await request(app).put(CANONICAL_PATH).send({ webhookUrl: 'https://hooks.example.com/x' });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ webhookUrl: 'https://hooks.example.com/x' });

    const get = await request(app).get(CANONICAL_PATH);
    expect(get.status).toBe(200);
    expect(get.body).toMatchObject({ webhookUrl: 'https://hooks.example.com/x' });
  });

  it('PUT never echoes the secret, only secretSet', async () => {
    const { app } = buildApp();

    const put = await request(app)
      .put(CANONICAL_PATH)
      .send({ webhookUrl: 'https://hooks.example.com/x', secret: 'super-secret-value' });

    expect(put.status).toBe(200);
    expect(put.body.secretSet).toBe(true);
    expect(put.body.secret).toBeUndefined();
    expect(JSON.stringify(put.body)).not.toContain('super-secret-value');
  });

  it('PUT with an invalid URL returns 400', async () => {
    const { app } = buildApp();

    const response = await request(app).put(CANONICAL_PATH).send({ webhookUrl: 'not-a-url' });

    expect(response.status).toBe(400);
  });

  it('PUT with a non-http(s) scheme returns 400', async () => {
    const { app } = buildApp();

    const response = await request(app).put(CANONICAL_PATH).send({ webhookUrl: 'ftp://host/x' });

    expect(response.status).toBe(400);
  });

  it('rejects a non-supervisor PUT with 403 and no write', async () => {
    const { app, repository } = buildApp(() => ANALYST_ORG_1);

    const response = await request(app).put(CANONICAL_PATH).send({ webhookUrl: 'https://hooks.example.com/x' });

    expect(response.status).toBe(403);
    const stored = await repository.findByOrganization(oid('org-1') as never);
    expect(stored).toBeNull();
  });

  it('rejects a non-supervisor GET with 403', async () => {
    const { app } = buildApp(() => ANALYST_ORG_1);

    const response = await request(app).get(CANONICAL_PATH);

    expect(response.status).toBe(403);
  });

  it('rejects an unauthenticated GET with 401', async () => {
    const { app } = buildApp(null);

    const response = await request(app).get(CANONICAL_PATH);

    expect(response.status).toBe(401);
  });

  it('rejects an unauthenticated PUT with 401', async () => {
    const { app } = buildApp(null);

    const response = await request(app).put(CANONICAL_PATH).send({ webhookUrl: 'https://hooks.example.com/x' });

    expect(response.status).toBe(401);
  });
});
