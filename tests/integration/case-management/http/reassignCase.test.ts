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
import { caseRouter } from '../../../../src/modules/case-management/infrastructure/adapters/inbound/http/caseRouter.js';
import { createCreateCaseUseCase } from '../../../../src/modules/case-management/application/CreateCase.js';
import { createCalculateSlaUseCase } from '../../../../src/modules/case-management/application/CalculateSla.js';
import { createRouteCaseUseCase } from '../../../../src/modules/case-management/application/RouteCase.js';
import { createReassignCaseUseCase } from '../../../../src/modules/case-management/application/ReassignCase.js';
import { ZenRoutingEngine } from '../../../../src/modules/case-management/infrastructure/adapters/outbound/zen/ZenRoutingEngine.js';
import { InMemoryCaseRepository } from '../../../helpers/case-management/InMemoryCaseRepository.js';
import { InMemoryTimelineRecorder } from '../../../helpers/case-management/InMemoryTimelineRecorder.js';
import { InMemoryCaseManagementAuditRecorder } from '../../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';
import { InMemoryCaseRoutingRuleRepository } from '../../../helpers/case-management/InMemoryCaseRoutingRuleRepository.js';
import { InMemoryOrganizationFraudConfigRepository } from '../../../helpers/case-management/InMemoryOrganizationFraudConfigRepository.js';
import { InMemoryCaseSlaTrackingRepository } from '../../../helpers/case-management/InMemoryCaseSlaTrackingRepository.js';
import { InMemoryAssigneeDirectory } from '../../../helpers/case-management/InMemoryAssigneeDirectory.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/case-management/infrastructure/PassthroughUnitOfWork.js';
import { generateCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { generateTimelineEventId } from '../../../../src/modules/case-management/domain/model/value-objects/TimelineEventId.js';
import { generateCaseSlaTrackingId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseSlaTrackingId.js';
import { OrganizationFraudConfig } from '../../../../src/modules/case-management/domain/model/aggregates/OrganizationFraudConfig.js';
import { generateOrganizationFraudConfigId } from '../../../../src/modules/case-management/domain/model/value-objects/OrganizationFraudConfigId.js';
import { Case } from '../../../../src/modules/case-management/domain/model/aggregates/Case.js';
import { createCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { createRiskScore } from '../../../../src/modules/case-management/domain/model/value-objects/RiskScore.js';
import { createAssignedTo } from '../../../../src/modules/case-management/domain/model/value-objects/AssignedTo.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_1 = oid('org-1');
const ORG_1_ANALYST = createAuthContext({ userId: oid('analyst-1'), organizationId: ORG_1, actorType: 'USER' });
const CASE_ID = createCaseId(oid('case-reassign-1'));
const TARGET_USER = oid('analyst-2');

function buildApp(actorPerRequest: () => AuthContext = () => ORG_1_ANALYST) {
  const cases = new InMemoryCaseRepository();
  const timelineRecorder = new InMemoryTimelineRecorder();
  const auditRecorder = new InMemoryCaseManagementAuditRecorder();
  const routingRules = new InMemoryCaseRoutingRuleRepository();
  const clock = new FixedClock(NOW);
  const fraudConfig = new InMemoryOrganizationFraudConfigRepository();
  const slaTracking = new InMemoryCaseSlaTrackingRepository();
  const assigneeDirectory = new InMemoryAssigneeDirectory();

  fraudConfig.seed(
    OrganizationFraudConfig.create({
      id: generateOrganizationFraudConfigId(),
      organizationId: ORG_1,
      slaLowMinutes: 240,
      slaMediumMinutes: 120,
      slaHighMinutes: 60,
      slaCriticalMinutes: 30,
      riskThresholdLow: 25,
      riskThresholdMedium: 50,
      riskThresholdHigh: 75,
      riskThresholdCritical: 90,
      featureFlags: {},
      now: NOW,
    }),
  );

  const unitOfWork = new PassthroughUnitOfWork();
  const routeCase = createRouteCaseUseCase({
    cases,
    routingRules,
    routingEngine: new ZenRoutingEngine(),
    timelineRecorder,
    auditRecorder,
    fraudConfig,
    clock,
    generateTimelineEventId,
  });
  const calculateSla = createCalculateSlaUseCase({
    cases,
    slaTracking,
    fraudConfig,
    clock,
    generateCaseSlaTrackingId,
  });

  const router = caseRouter({
    createCase: createCreateCaseUseCase({
      cases,
      timelineRecorder,
      unitOfWork,
      clock,
      generateCaseId,
      generateTimelineEventId,
      auditRecorder,
      routeCase,
      calculateSla,
    }),
    reassignCase: createReassignCaseUseCase({
      cases,
      timelineRecorder,
      auditRecorder,
      unitOfWork,
      clock,
      generateTimelineEventId,
      assigneeDirectory,
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

  return { app, cases, timelineRecorder, auditRecorder, assigneeDirectory };
}

describe('caseRouter POST /cases/:caseId/reassign', () => {
  it('reassigns a same-org case and returns the updated assignee', async () => {
    const { app, cases, assigneeDirectory, auditRecorder, timelineRecorder } = buildApp();
    await cases.save(
      Case.create({
        id: CASE_ID,
        organizationId: ORG_1,
        customerId: 'customer-1',
        riskScore: createRiskScore(40),
        priority: 'MEDIUM',
        now: NOW,
      }),
    );
    assigneeDirectory.allow(ORG_1, createAssignedTo('USER', TARGET_USER));

    const response = await request(app)
      .post(`/api/v1/cases/${CASE_ID}/reassign`)
      .send({ assignedToType: 'USER', assignedToId: TARGET_USER });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: CASE_ID,
      assignedTo: { type: 'USER', id: TARGET_USER },
    });
    expect(auditRecorder.all()[0]?.detail).toMatchObject({ trigger: 'MANUAL' });
    expect(timelineRecorder.all()[0]?.eventType).toBe('ASSIGNED');
  });

  it('returns 404 CASE_NOT_FOUND for a soft-deleted case', async () => {
    const { app, cases, assigneeDirectory } = buildApp();
    const live = Case.create({
      id: CASE_ID,
      organizationId: ORG_1,
      customerId: 'customer-1',
      riskScore: createRiskScore(40),
      priority: 'MEDIUM',
      now: NOW,
    });
    await cases.save(
      Case.rehydrate({
        id: live.id,
        organizationId: live.organizationId,
        customerId: live.customerId,
        customerEmail: live.customerEmail,
        bridgeUserId: live.bridgeUserId,
        bridgeWallet: live.bridgeWallet,
        stripeCustomerId: live.stripeCustomerId,
        finturuReference: live.finturuReference,
        finturuCacheSnapshot: live.finturuCacheSnapshot,
        riskScore: live.riskScore,
        status: live.status,
        priority: live.priority,
        assignedTo: live.assignedTo,
        dueDate: live.dueDate,
        tags: live.tags,
        createdAt: live.createdAt,
        updatedAt: live.updatedAt,
        deletedAt: NOW,
      }),
    );
    assigneeDirectory.allow(ORG_1, createAssignedTo('USER', TARGET_USER));

    const response = await request(app)
      .post(`/api/v1/cases/${CASE_ID}/reassign`)
      .send({ assignedToType: 'USER', assignedToId: TARGET_USER });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('CASE_NOT_FOUND');
  });

  it('returns 403 FORBIDDEN_CROSS_TENANT when assignee is not in the organization', async () => {
    const { app, cases } = buildApp();
    await cases.save(
      Case.create({
        id: CASE_ID,
        organizationId: ORG_1,
        customerId: 'customer-1',
        riskScore: createRiskScore(40),
        priority: 'MEDIUM',
        now: NOW,
      }),
    );

    const response = await request(app)
      .post(`/api/v1/cases/${CASE_ID}/reassign`)
      .send({ assignedToType: 'USER', assignedToId: TARGET_USER });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN_CROSS_TENANT');
  });

  it('returns 400 INVARIANT_VIOLATION when reassigning to the same assignee', async () => {
    const { app, cases, assigneeDirectory } = buildApp();
    const assigned = createAssignedTo('USER', TARGET_USER);
    await cases.save(
      Case.create({
        id: CASE_ID,
        organizationId: ORG_1,
        customerId: 'customer-1',
        riskScore: createRiskScore(40),
        priority: 'MEDIUM',
        now: NOW,
      }).reassign(assigned, NOW),
    );
    assigneeDirectory.allow(ORG_1, assigned);

    const response = await request(app)
      .post(`/api/v1/cases/${CASE_ID}/reassign`)
      .send({ assignedToType: 'USER', assignedToId: TARGET_USER });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
  });

  it('returns 400 when assignedToType is invalid', async () => {
    const { app } = buildApp();

    const response = await request(app)
      .post(`/api/v1/cases/${CASE_ID}/reassign`)
      .send({ assignedToType: 'TEAM', assignedToId: TARGET_USER });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
  });
});
