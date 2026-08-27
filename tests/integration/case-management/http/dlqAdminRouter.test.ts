/**
 * HTTP contract tests for `dlqAdminRouter`.
 *
 * Threat-matrix coverage (D design):
 *  - No auth → 401 (UNAUTHENTICATED)
 *  - USER actor → 403 (FORBIDDEN_CROSS_TENANT)
 *  - ORGANIZATION actor → 403 (FORBIDDEN_CROSS_TENANT)
 *  - PLATFORM_ADMIN → 200/204
 *  - Tenant actor with matching ?organizationId → 403 (still blocked)
 *  - Malformed cursor → 400 (INVARIANT_VIOLATION)
 *  - Unknown id → 404 (DLQ_EVENT_NOT_FOUND)
 *  - list omits payload; inspect includes error_trace + payload
 */
import { Router, type Request, type NextFunction, type Response } from 'express';
import request from 'supertest';
import { createApp } from '../../../../src/shared/http/createApp.js';
import { createErrorHandler } from '../../../../src/shared/http/errorHandler.js';
import { attachAuthContext } from '../../../../src/shared/http/requestAuthContext.js';
import { createAuthContext, type AuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { caseManagementErrorStatus } from '../../../../src/modules/case-management/infrastructure/adapters/inbound/http/errorStatus.js';
import { dlqAdminRouter } from '../../../../src/modules/case-management/infrastructure/adapters/inbound/http/dlqAdminRouter.js';
import { createListDlqEventsUseCase } from '../../../../src/modules/case-management/application/ListDlqEvents.js';
import { createGetDlqEventUseCase } from '../../../../src/modules/case-management/application/GetDlqEvent.js';
import { createRequeueDlqEventUseCase } from '../../../../src/modules/case-management/application/RequeueDlqEvent.js';
import { InMemoryOutboxDlqRepository } from '../../../helpers/case-management/InMemoryOutboxDlqRepository.js';
import { InMemoryOutboxEventRepository } from '../../../helpers/case-management/InMemoryOutboxEventRepository.js';
import { InMemoryCaseManagementAuditRecorder } from '../../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/case-management/infrastructure/PassthroughUnitOfWork.js';
import { DeadLetterEvent } from '../../../../src/shared/outbox/DeadLetterEvent.js';
import { OutboxEvent } from '../../../../src/shared/outbox/OutboxEvent.js';
import { generateOutboxEventId } from '../../../../src/shared/outbox/OutboxEventId.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { oid } from '../../../support/oid.js';
import { encodeDescCursor } from '../../../../src/shared/http/pagination.js';

const ORG_ID = oid('org-dlq-http-1');
const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const T1 = fromDate(new Date('2026-01-01T01:00:00.000Z'));
const T2 = fromDate(new Date('2026-01-01T02:00:00.000Z'));

const PLATFORM_ADMIN = createAuthContext({
  userId: oid('admin-1'),
  organizationId: null,
  actorType: 'PLATFORM_ADMIN',
  isPlatformAdmin: true,
});

const USER_ACTOR = createAuthContext({
  userId: oid('user-1'),
  organizationId: ORG_ID,
  actorType: 'USER',
});

const ORG_ACTOR = createAuthContext({
  userId: oid('org-1'),
  organizationId: ORG_ID,
  actorType: 'ORGANIZATION',
});

function makeDead(orgId: string, exhaustedAt = T1, reason = 'kafka failure'): DeadLetterEvent {
  const event = OutboxEvent.create({
    id: generateOutboxEventId(),
    organizationId: orgId,
    eventType: 'case.created',
    aggregateType: 'Case',
    aggregateId: oid('agg-1'),
    payload: { secret: 'payload-data', amount: 100 },
    now: NOW,
  });
  const exhausted = event.markExhausted(reason);
  return DeadLetterEvent.from(exhausted, exhaustedAt);
}

/** Builds an in-memory app with auth context middleware for the given actor. */
function buildApp(actor: AuthContext) {
  const dlqRepository = new InMemoryOutboxDlqRepository();
  const outboxRepository = new InMemoryOutboxEventRepository();
  const auditRecorder = new InMemoryCaseManagementAuditRecorder();
  const unitOfWork = new PassthroughUnitOfWork();

  const listDlqEvents = createListDlqEventsUseCase({ dlq: dlqRepository });
  const getDlqEvent = createGetDlqEventUseCase({ dlq: dlqRepository });
  const requeueDlqEvent = createRequeueDlqEventUseCase({
    dlq: dlqRepository,
    outbox: outboxRepository,
    unitOfWork,
    auditRecorder,
  });

  const authMiddleware = (req: Request, _res: Response, next: NextFunction) => {
    attachAuthContext(req, actor);
    next();
  };

  const apiRouter = Router();
  apiRouter.use(authMiddleware);
  apiRouter.use(dlqAdminRouter({ listDlqEvents, getDlqEvent, requeueDlqEvent }));

  return {
    app: createApp({
      routers: [{ path: '/api/v1', router: apiRouter }],
      errorHandler: createErrorHandler({
        UNAUTHENTICATED: 401,
        ...caseManagementErrorStatus,
      }),
    }),
    dlqRepository,
  };
}

/** Builds an app WITHOUT any auth middleware (simulates no Bearer token). */
function buildUnauthenticatedApp() {
  const dlqRepository = new InMemoryOutboxDlqRepository();
  const outboxRepository = new InMemoryOutboxEventRepository();
  const auditRecorder = new InMemoryCaseManagementAuditRecorder();
  const unitOfWork = new PassthroughUnitOfWork();

  const listDlqEvents = createListDlqEventsUseCase({ dlq: dlqRepository });
  const getDlqEvent = createGetDlqEventUseCase({ dlq: dlqRepository });
  const requeueDlqEvent = createRequeueDlqEventUseCase({
    dlq: dlqRepository,
    outbox: outboxRepository,
    unitOfWork,
    auditRecorder,
  });

  const apiRouter = Router();
  // No authMiddleware — requests arrive with no authContext
  apiRouter.use(dlqAdminRouter({ listDlqEvents, getDlqEvent, requeueDlqEvent }));

  return createApp({
    routers: [{ path: '/api/v1', router: apiRouter }],
    errorHandler: createErrorHandler({
      UNAUTHENTICATED: 401,
      ...caseManagementErrorStatus,
    }),
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// GET /dlq-events
// ──────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/dlq-events', () => {
  it('returns 401 when no auth context is attached (UNAUTHENTICATED)', async () => {
    const app = buildUnauthenticatedApp();
    const res = await request(app).get('/api/v1/dlq-events');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('returns 403 for USER actor (FORBIDDEN_CROSS_TENANT)', async () => {
    const { app } = buildApp(USER_ACTOR);
    const res = await request(app).get('/api/v1/dlq-events');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN_CROSS_TENANT');
  });

  it('returns 403 for ORGANIZATION actor (FORBIDDEN_CROSS_TENANT)', async () => {
    const { app } = buildApp(ORG_ACTOR);
    const res = await request(app).get('/api/v1/dlq-events');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN_CROSS_TENANT');
  });

  it('returns 403 for USER actor even when ?organizationId matches their own org', async () => {
    const { app } = buildApp(USER_ACTOR);
    const res = await request(app).get(`/api/v1/dlq-events?organizationId=${ORG_ID}`);
    expect(res.status).toBe(403);
  });

  it('returns 400 for a malformed cursor (INVARIANT_VIOLATION)', async () => {
    const { app } = buildApp(PLATFORM_ADMIN);
    const res = await request(app).get('/api/v1/dlq-events?cursor=!!!notbase64!!!');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVARIANT_VIOLATION');
  });

  it('returns 200 with items and nextCursor for PLATFORM_ADMIN', async () => {
    const { app, dlqRepository } = buildApp(PLATFORM_ADMIN);
    await dlqRepository.save(makeDead(ORG_ID, T1));

    const res = await request(app).get('/api/v1/dlq-events');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.nextCursor).toBeNull();
  });

  it('list response OMITS the payload field from each item', async () => {
    const { app, dlqRepository } = buildApp(PLATFORM_ADMIN);
    await dlqRepository.save(makeDead(ORG_ID, T1));

    const res = await request(app).get('/api/v1/dlq-events');
    expect(res.status).toBe(200);
    const item = res.body.items[0];
    expect(item).not.toHaveProperty('payload');
  });

  it('?organizationId scopes results to that tenant for PLATFORM_ADMIN', async () => {
    const ORG_B = oid('org-b-http');
    const { app, dlqRepository } = buildApp(PLATFORM_ADMIN);
    await dlqRepository.save(makeDead(ORG_ID, T1));
    await dlqRepository.save(makeDead(ORG_B, T2));

    const res = await request(app).get(`/api/v1/dlq-events?organizationId=${ORG_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].organizationId).toBe(ORG_ID);
  });

  it('PLATFORM_ADMIN without ?organizationId sees cross-tenant rows', async () => {
    const ORG_B = oid('org-b-cross');
    const { app, dlqRepository } = buildApp(PLATFORM_ADMIN);
    await dlqRepository.save(makeDead(ORG_ID, T1));
    await dlqRepository.save(makeDead(ORG_B, T2));

    const res = await request(app).get('/api/v1/dlq-events');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
  });

  it('returns items with standard DLQ metadata fields (no payload)', async () => {
    const dead = makeDead(ORG_ID, T1, 'broker timeout');
    const { app, dlqRepository } = buildApp(PLATFORM_ADMIN);
    await dlqRepository.save(dead);

    const res = await request(app).get('/api/v1/dlq-events');
    const item = res.body.items[0];
    expect(item.id).toBe(dead.id);
    expect(item.organizationId).toBe(ORG_ID);
    expect(item.eventType).toBe('case.created');
    expect(item.publishAttempts).toBeGreaterThanOrEqual(1);
    expect(item).not.toHaveProperty('payload');
    expect(item).not.toHaveProperty('error_trace');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /dlq-events/:id
// ──────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/dlq-events/:id', () => {
  it('returns 401 when no auth context is attached', async () => {
    const app = buildUnauthenticatedApp();
    const res = await request(app).get(`/api/v1/dlq-events/${generateOutboxEventId()}`);
    expect(res.status).toBe(401);
  });

  it('returns 403 for USER actor', async () => {
    const { app } = buildApp(USER_ACTOR);
    const res = await request(app).get(`/api/v1/dlq-events/${generateOutboxEventId()}`);
    expect(res.status).toBe(403);
  });

  it('returns 403 for ORGANIZATION actor', async () => {
    const { app } = buildApp(ORG_ACTOR);
    const res = await request(app).get(`/api/v1/dlq-events/${generateOutboxEventId()}`);
    expect(res.status).toBe(403);
  });

  it('returns 404 when the DLQ event id does not exist (DLQ_EVENT_NOT_FOUND)', async () => {
    const { app } = buildApp(PLATFORM_ADMIN);
    const nonExistent = generateOutboxEventId();
    const res = await request(app).get(`/api/v1/dlq-events/${nonExistent}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('DLQ_EVENT_NOT_FOUND');
  });

  it('returns 200 with error_trace (mapped from reason) and full payload', async () => {
    const dead = makeDead(ORG_ID, T1, 'topic does not exist');
    const { app, dlqRepository } = buildApp(PLATFORM_ADMIN);
    await dlqRepository.save(dead);

    const res = await request(app).get(`/api/v1/dlq-events/${dead.id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(dead.id);
    expect(res.body.error_trace).toBe('topic does not exist');
    expect(res.body.payload).toStrictEqual(dead.payload);
  });

  it('inspect response includes all metadata fields and error_trace', async () => {
    const dead = makeDead(ORG_ID, T1, 'connection refused');
    const { app, dlqRepository } = buildApp(PLATFORM_ADMIN);
    await dlqRepository.save(dead);

    const res = await request(app).get(`/api/v1/dlq-events/${dead.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: dead.id,
      organizationId: ORG_ID,
      eventType: 'case.created',
      error_trace: 'connection refused',
    });
    expect(res.body.payload).toBeDefined();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /dlq-events/:id/requeue
// ──────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/dlq-events/:id/requeue', () => {
  it('returns 401 when no auth context is attached', async () => {
    const app = buildUnauthenticatedApp();
    const res = await request(app).post(`/api/v1/dlq-events/${generateOutboxEventId()}/requeue`);
    expect(res.status).toBe(401);
  });

  it('returns 403 for USER actor', async () => {
    const { app } = buildApp(USER_ACTOR);
    const res = await request(app).post(`/api/v1/dlq-events/${generateOutboxEventId()}/requeue`);
    expect(res.status).toBe(403);
  });

  it('returns 403 for ORGANIZATION actor', async () => {
    const { app } = buildApp(ORG_ACTOR);
    const res = await request(app).post(`/api/v1/dlq-events/${generateOutboxEventId()}/requeue`);
    expect(res.status).toBe(403);
  });

  it('returns 404 when the DLQ event does not exist', async () => {
    const { app } = buildApp(PLATFORM_ADMIN);
    const nonExistent = generateOutboxEventId();
    const res = await request(app).post(`/api/v1/dlq-events/${nonExistent}/requeue`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('DLQ_EVENT_NOT_FOUND');
  });

  it('returns 200 with newOutboxId on successful requeue', async () => {
    const dead = makeDead(ORG_ID, T1);
    const { app, dlqRepository } = buildApp(PLATFORM_ADMIN);
    await dlqRepository.save(dead);

    const res = await request(app).post(`/api/v1/dlq-events/${dead.id}/requeue`);
    expect(res.status).toBe(200);
    expect(typeof res.body.newOutboxId).toBe('string');
    expect(res.body.newOutboxId).not.toBe(dead.id);
  });

  it('duplicate requeue of an already-deleted DLQ row returns 404', async () => {
    const dead = makeDead(ORG_ID, T1);
    const { app, dlqRepository } = buildApp(PLATFORM_ADMIN);
    await dlqRepository.save(dead);

    // First requeue succeeds
    const res1 = await request(app).post(`/api/v1/dlq-events/${dead.id}/requeue`);
    expect(res1.status).toBe(200);

    // Second requeue must return 404 (row already gone)
    const res2 = await request(app).post(`/api/v1/dlq-events/${dead.id}/requeue`);
    expect(res2.status).toBe(404);
  });
});
