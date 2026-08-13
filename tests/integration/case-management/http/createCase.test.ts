import { oid } from '../../../support/oid.js';
import { Router, type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { createApp } from '../../../../src/shared/http/createApp.js';
import { createErrorHandler } from '../../../../src/shared/http/errorHandler.js';
import { attachAuthContext } from '../../../../src/shared/http/requestAuthContext.js';
import { createAuthContext, type AuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { SystemClock } from '../../../../src/shared/time/SystemClock.js';
import { caseManagementErrorStatus } from '../../../../src/modules/case-management/infrastructure/adapters/inbound/http/errorStatus.js';
import { caseRouter } from '../../../../src/modules/case-management/infrastructure/adapters/inbound/http/caseRouter.js';
import { createCreateCaseUseCase } from '../../../../src/modules/case-management/application/CreateCase.js';
import { InMemoryCaseRepository } from '../../../helpers/case-management/InMemoryCaseRepository.js';
import { InMemoryTimelineRecorder } from '../../../helpers/case-management/InMemoryTimelineRecorder.js';
import { InMemoryCaseManagementAuditRecorder } from '../../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/case-management/infrastructure/PassthroughUnitOfWork.js';
import { generateCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { generateTimelineEventId } from '../../../../src/modules/case-management/domain/model/value-objects/TimelineEventId.js';

const ORG_1_ANALYST = createAuthContext({ userId: oid('analyst-1'), organizationId: oid('org-1'), actorType: 'USER' });

function buildApp(actorPerRequest: () => AuthContext) {
  const cases = new InMemoryCaseRepository();
  const timelineRecorder = new InMemoryTimelineRecorder();
  const auditRecorder = new InMemoryCaseManagementAuditRecorder();

  const router = caseRouter({
    createCase: createCreateCaseUseCase({
      cases,
      timelineRecorder,
      unitOfWork: new PassthroughUnitOfWork(),
      clock: new SystemClock(),
      generateCaseId,
      generateTimelineEventId,
      auditRecorder,
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

  return { app, cases, timelineRecorder, auditRecorder };
}

describe('caseRouter (e2e, in-memory repository)', () => {
  it('POST /cases creates a Case scoped to the caller\'s organization, status OPEN, 201 shape', async () => {
    const { app } = buildApp(() => ORG_1_ANALYST);

    const response = await request(app)
      .post('/api/v1/cases')
      .send({ customerId: 'customer-1', riskScore: 75, priority: 'HIGH' });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      organizationId: oid('org-1'),
      customerId: 'customer-1',
      riskScore: 75,
      priority: 'HIGH',
      status: 'OPEN',
      assignedTo: null,
      dueDate: null,
    });
    expect(typeof response.body.id).toBe('string');
  });

  it('POST /cases defaults priority to LOW when omitted', async () => {
    const { app } = buildApp(() => ORG_1_ANALYST);

    const response = await request(app).post('/api/v1/cases').send({ customerId: 'customer-1', riskScore: 10 });

    expect(response.status).toBe(201);
    expect(response.body.priority).toBe('LOW');
  });

  it('POST /cases rejects an out-of-range riskScore with 400 (zod validation -> INVARIANT_VIOLATION)', async () => {
    const { app } = buildApp(() => ORG_1_ANALYST);

    const response = await request(app).post('/api/v1/cases').send({ customerId: 'customer-1', riskScore: 101 });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
  });

  it('POST /cases rejects a missing customerId with 400', async () => {
    const { app } = buildApp(() => ORG_1_ANALYST);

    const response = await request(app).post('/api/v1/cases').send({ riskScore: 10 });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
  });

  it('POST /cases rejects a caller with no organization context with 403 FORBIDDEN_CROSS_TENANT', async () => {
    const platformAdminNoOrg = createAuthContext({ userId: 'pa-1', organizationId: null, isPlatformAdmin: true });
    const { app } = buildApp(() => platformAdminNoOrg);

    const response = await request(app).post('/api/v1/cases').send({ customerId: 'customer-1', riskScore: 10 });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN_CROSS_TENANT');
  });

  it('records exactly one CASE_CREATED timeline entry and one CREATE_CASE audit event per POST', async () => {
    const { app, timelineRecorder, auditRecorder } = buildApp(() => ORG_1_ANALYST);

    await request(app).post('/api/v1/cases').send({ customerId: 'customer-1', riskScore: 10 });

    expect(timelineRecorder.all()).toHaveLength(1);
    expect(timelineRecorder.all()[0]?.eventType).toBe('CASE_CREATED');
    expect(auditRecorder.all()).toHaveLength(1);
    expect(auditRecorder.all()[0]?.action).toBe('CREATE_CASE');
    expect(auditRecorder.all()[0]?.resource).toBe('case');
  });
});
