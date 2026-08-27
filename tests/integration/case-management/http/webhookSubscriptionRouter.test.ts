import { oid } from '../../../support/oid.js';
import { Router, type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { createApp } from '../../../../src/shared/http/createApp.js';
import { createErrorHandler } from '../../../../src/shared/http/errorHandler.js';
import { attachAuthContext } from '../../../../src/shared/http/requestAuthContext.js';
import { createAuthContext, type AuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { caseManagementErrorStatus } from '../../../../src/modules/case-management/infrastructure/adapters/inbound/http/errorStatus.js';
import { webhookSubscriptionRouter } from '../../../../src/modules/case-management/infrastructure/adapters/inbound/http/webhookSubscriptionRouter.js';
import { createCreateWebhookSubscriptionUseCase } from '../../../../src/modules/case-management/application/CreateWebhookSubscription.js';
import { createListWebhookSubscriptionUseCase } from '../../../../src/modules/case-management/application/ListWebhookSubscription.js';
import { createGetWebhookSubscriptionUseCase } from '../../../../src/modules/case-management/application/GetWebhookSubscription.js';
import { createUpdateWebhookSubscriptionUseCase } from '../../../../src/modules/case-management/application/UpdateWebhookSubscription.js';
import { createDeleteWebhookSubscriptionUseCase } from '../../../../src/modules/case-management/application/DeleteWebhookSubscription.js';
import { generateCustomerWebhookSubscriptionId } from '../../../../src/modules/case-management/domain/model/value-objects/CustomerWebhookSubscriptionId.js';
import { InMemoryCustomerWebhookSubscriptionRepository } from '../../../helpers/case-management/InMemoryCustomerWebhookSubscriptionRepository.js';
import { InMemoryCaseManagementAuditRecorder } from '../../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';
import { InMemoryUnitOfWork } from '../../../helpers/case-management/InMemoryUnitOfWork.js';
import { FixedClock } from '../../../helpers/FixedClock.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG = oid('org-1');
const URL_A = 'https://hooks.example.com/a';
const URL_B = 'https://hooks.example.com/b';

function supervisor(organizationId = ORG): AuthContext {
  return createAuthContext({
    userId: oid('user-1'),
    organizationId,
    roleId: 'SUPERVISOR',
  });
}

function buildApp(actorPerRequest: () => AuthContext) {
  const subscriptions = new InMemoryCustomerWebhookSubscriptionRepository();
  const auditRecorder = new InMemoryCaseManagementAuditRecorder();
  const unitOfWork = new InMemoryUnitOfWork();
  const clock = new FixedClock(NOW);
  const api = Router();
  api.use((req: Request, _res: Response, next: NextFunction) => {
    attachAuthContext(req, actorPerRequest());
    next();
  });
  api.use(
    webhookSubscriptionRouter({
      createWebhookSubscription: createCreateWebhookSubscriptionUseCase({
        subscriptions,
        auditRecorder,
        unitOfWork,
        clock,
        generateCustomerWebhookSubscriptionId,
      }),
      listWebhookSubscription: createListWebhookSubscriptionUseCase({ subscriptions }),
      getWebhookSubscription: createGetWebhookSubscriptionUseCase({ subscriptions }),
      updateWebhookSubscription: createUpdateWebhookSubscriptionUseCase({
        subscriptions,
        auditRecorder,
        unitOfWork,
        clock,
      }),
      deleteWebhookSubscription: createDeleteWebhookSubscriptionUseCase({
        subscriptions,
        auditRecorder,
        unitOfWork,
      }),
    }),
  );

  return {
    app: createApp({
      routers: [{ path: '/api/v1', router: api }],
      errorHandler: createErrorHandler({ ...caseManagementErrorStatus }),
    }),
    subscriptions,
    auditRecorder,
  };
}

describe('webhookSubscriptionRouter (HTTP)', () => {
  it('POST creates an active subscription for SUPERVISOR with 201 and audit', async () => {
    const { app, subscriptions, auditRecorder } = buildApp(() => supervisor());

    const response = await request(app)
      .post('/api/v1/webhook-subscriptions')
      .send({ url: URL_A, eventTypes: ['case.created'] })
      .expect(201);

    expect(response.body.url).toBe(URL_A);
    expect(response.body.eventTypes).toEqual(['case.created']);
    expect(response.body.active).toBe(true);
    expect(response.body.organizationId).toBe(ORG);
    expect(response.body.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(subscriptions.all()).toHaveLength(1);
    expect(auditRecorder.all()[0]).toMatchObject({
      action: 'CREATE_WEBHOOK_SUBSCRIPTION',
      resource: 'webhook_subscription',
    });
  });

  it('GET lists tenant rows and GET by id returns the row', async () => {
    const { app } = buildApp(() => supervisor());
    const created = await request(app)
      .post('/api/v1/webhook-subscriptions')
      .send({ url: URL_A, eventTypes: ['case.created'] })
      .expect(201);

    const listed = await request(app).get('/api/v1/webhook-subscriptions').expect(200);
    expect(listed.body.items).toHaveLength(1);
    expect(listed.body.items[0].id).toBe(created.body.id);

    const got = await request(app)
      .get(`/api/v1/webhook-subscriptions/${created.body.id}`)
      .expect(200);
    expect(got.body.id).toBe(created.body.id);
    expect(got.body.url).toBe(URL_A);
  });

  it('PATCH updates url, eventTypes, and active as UPDATE audit', async () => {
    const { app, auditRecorder } = buildApp(() => supervisor());
    const created = await request(app)
      .post('/api/v1/webhook-subscriptions')
      .send({ url: URL_A, eventTypes: ['case.created'] })
      .expect(201);

    const patched = await request(app)
      .patch(`/api/v1/webhook-subscriptions/${created.body.id}`)
      .send({ url: URL_B, eventTypes: ['case.resolved'], active: false })
      .expect(200);

    expect(patched.body.url).toBe(URL_B);
    expect(patched.body.eventTypes).toEqual(['case.resolved']);
    expect(patched.body.active).toBe(false);
    expect(auditRecorder.all().map((event) => event.action)).toEqual([
      'CREATE_WEBHOOK_SUBSCRIPTION',
      'UPDATE_WEBHOOK_SUBSCRIPTION',
    ]);
  });

  it('DELETE hard-removes the row and audits DELETE', async () => {
    const { app, subscriptions, auditRecorder } = buildApp(() => supervisor());
    const created = await request(app)
      .post('/api/v1/webhook-subscriptions')
      .send({ url: URL_A, eventTypes: ['case.created'] })
      .expect(201);

    const deleted = await request(app)
      .delete(`/api/v1/webhook-subscriptions/${created.body.id}`)
      .expect(200);
    expect(deleted.body.id).toBe(created.body.id);
    expect(subscriptions.all()).toHaveLength(0);
    expect(auditRecorder.all().at(-1)).toMatchObject({
      action: 'DELETE_WEBHOOK_SUBSCRIPTION',
      resource: 'webhook_subscription',
    });
  });

  it('rejects unauthorized writes with 403', async () => {
    for (const roleId of ['ANALYST', 'ADMIN', 'AUDITOR'] as const) {
      const { app, subscriptions } = buildApp(() =>
        createAuthContext({
          userId: oid('user-1'),
          organizationId: ORG,
          roleId,
        }),
      );

      await request(app)
        .post('/api/v1/webhook-subscriptions')
        .send({ url: URL_A, eventTypes: ['case.created'] })
        .expect(403);
      expect(subscriptions.all()).toHaveLength(0);
    }

    const { app } = buildApp(() =>
      createAuthContext({
        userId: oid('org-1'),
        organizationId: ORG,
        actorType: 'ORGANIZATION',
      }),
    );
    await request(app)
      .post('/api/v1/webhook-subscriptions')
      .send({ url: URL_A, eventTypes: ['case.created'] })
      .expect(403);
  });

  it('allows OVERSIGHT_READ_ROLES to list and get without extra audit', async () => {
    let actor = supervisor();
    const { app, auditRecorder } = buildApp(() => actor);
    const created = await request(app)
      .post('/api/v1/webhook-subscriptions')
      .send({ url: URL_A, eventTypes: ['case.created'] })
      .expect(201);
    const writes = auditRecorder.all().length;

    actor = createAuthContext({
      userId: oid('user-1'),
      organizationId: ORG,
      roleId: 'AUDITOR',
    });
    await request(app).get('/api/v1/webhook-subscriptions').expect(200);
    await request(app).get(`/api/v1/webhook-subscriptions/${created.body.id}`).expect(200);

    actor = createAuthContext({
      userId: oid('user-1'),
      organizationId: ORG,
      roleId: 'ADMIN',
    });
    await request(app).get('/api/v1/webhook-subscriptions').expect(200);

    actor = createAuthContext({
      userId: oid('org-1'),
      organizationId: ORG,
      actorType: 'ORGANIZATION',
    });
    await request(app).get('/api/v1/webhook-subscriptions').expect(200);
    expect(auditRecorder.all()).toHaveLength(writes);
  });

  it('rejects empty eventTypes, non-http URL, and Kafka names with 400', async () => {
    const { app, subscriptions } = buildApp(() => supervisor());

    await request(app)
      .post('/api/v1/webhook-subscriptions')
      .send({ url: URL_A, eventTypes: [] })
      .expect(400);
    await request(app)
      .post('/api/v1/webhook-subscriptions')
      .send({ url: 'ftp://hooks.example.com/a', eventTypes: ['case.created'] })
      .expect(400);
    await request(app)
      .post('/api/v1/webhook-subscriptions')
      .send({ url: URL_A, eventTypes: ['CASE_RESOLVED'] })
      .expect(400);
    expect(subscriptions.all()).toHaveLength(0);
  });

  it('returns 409 for a duplicate URL and 404 for missing id', async () => {
    const { app } = buildApp(() => supervisor());
    await request(app)
      .post('/api/v1/webhook-subscriptions')
      .send({ url: URL_A, eventTypes: ['case.created'] })
      .expect(201);

    const duplicate = await request(app)
      .post('/api/v1/webhook-subscriptions')
      .send({ url: URL_A, eventTypes: ['case.resolved'] })
      .expect(409);
    expect(duplicate.body.error.code).toBe('WEBHOOK_SUBSCRIPTION_URL_TAKEN');

    const missing = await request(app)
      .get(`/api/v1/webhook-subscriptions/${oid('missing-subscription')}`)
      .expect(404);
    expect(missing.body.error.code).toBe('WEBHOOK_SUBSCRIPTION_NOT_FOUND');
  });
});
