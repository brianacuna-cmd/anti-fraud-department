import { oid } from '../../../support/oid.js';
import { Router, type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { createApp } from '../../../../src/shared/http/createApp.js';
import { createErrorHandler } from '../../../../src/shared/http/errorHandler.js';
import { attachAuthContext } from '../../../../src/shared/http/requestAuthContext.js';
import { createAuthContext, type AuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { fromDate, toDate } from '../../../../src/shared/time/Instant.js';
import { caseManagementErrorStatus } from '../../../../src/modules/case-management/infrastructure/adapters/inbound/http/errorStatus.js';
import { caseRouter } from '../../../../src/modules/case-management/infrastructure/adapters/inbound/http/caseRouter.js';
import { createCreateCaseUseCase } from '../../../../src/modules/case-management/application/CreateCase.js';
import { createCalculateSlaUseCase } from '../../../../src/modules/case-management/application/CalculateSla.js';
import { createRouteCaseUseCase } from '../../../../src/modules/case-management/application/RouteCase.js';
import { createReassignCaseUseCase } from '../../../../src/modules/case-management/application/ReassignCase.js';
import { createListCasesUseCase } from '../../../../src/modules/case-management/application/ListCases.js';
import { createGetCaseUseCase } from '../../../../src/modules/case-management/application/GetCase.js';
import { createGetCaseTimelineUseCase } from '../../../../src/modules/case-management/application/GetCaseTimeline.js';
import { createAddCaseNoteUseCase } from '../../../../src/modules/case-management/application/AddCaseNote.js';
import { createListCaseNotesUseCase } from '../../../../src/modules/case-management/application/ListCaseNotes.js';
import { InMemoryCaseNoteRepository } from '../../../helpers/case-management/InMemoryCaseNoteRepository.js';
import { generateCaseNoteId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseNoteId.js';
import { createReopenCaseUseCase } from '../../../../src/modules/case-management/application/ReopenCase.js';
import { ZenRoutingEngine } from '../../../../src/modules/case-management/infrastructure/adapters/outbound/zen/ZenRoutingEngine.js';
import { InMemoryCaseRepository } from '../../../helpers/case-management/InMemoryCaseRepository.js';
import { InMemoryTimelineRecorder } from '../../../helpers/case-management/InMemoryTimelineRecorder.js';
import { InMemoryCaseManagementAuditRecorder } from '../../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';
import { InMemoryCaseManagementNotificationSender } from '../../../helpers/case-management/InMemoryCaseManagementNotificationSender.js';
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
import { CaseSlaTracking } from '../../../../src/modules/case-management/domain/model/aggregates/CaseSlaTracking.js';
import { createCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { createRiskScore } from '../../../../src/modules/case-management/domain/model/value-objects/RiskScore.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const OLD_DUE = fromDate(new Date('2025-12-01T00:00:00.000Z'));
const ORG_1 = oid('org-1');
const CASE_ID = createCaseId(oid('case-reopen-http-1'));
const EXPECTED_DUE_ISO = new Date(toDate(NOW).getTime() + 120 * 60_000).toISOString();

const SUPERVISOR = createAuthContext({
  userId: oid('supervisor-1'),
  organizationId: ORG_1,
  actorType: 'USER',
  roleId: 'SUPERVISOR',
});
const ANALYST = createAuthContext({
  userId: oid('analyst-1'),
  organizationId: ORG_1,
  actorType: 'USER',
  roleId: 'ANALYST',
});

function buildResolvedCase(deleted = false): Case {
  const resolved = Case.create({
    id: CASE_ID,
    organizationId: ORG_1,
    customerId: 'customer-1',
    riskScore: createRiskScore(40),
    priority: 'MEDIUM',
    now: NOW,
  })
    .transitionTo('IN_REVIEW', NOW)
    .transitionTo('RESOLVED', NOW)
    .withDueDate(OLD_DUE, NOW);

  if (!deleted) return resolved;

  return Case.rehydrate({
    id: resolved.id,
    organizationId: resolved.organizationId,
    customerId: resolved.customerId,
    customerEmail: resolved.customerEmail,
    bridgeUserId: resolved.bridgeUserId,
    bridgeWallet: resolved.bridgeWallet,
    stripeCustomerId: resolved.stripeCustomerId,
    finturuReference: resolved.finturuReference,
    finturuCacheSnapshot: resolved.finturuCacheSnapshot,
    riskScore: resolved.riskScore,
    status: resolved.status,
    priority: resolved.priority,
    assignedTo: resolved.assignedTo,
    dueDate: resolved.dueDate,
    tags: resolved.tags,
    createdAt: resolved.createdAt,
    updatedAt: resolved.updatedAt,
    deletedAt: NOW,
  });
}

function buildApp(actorPerRequest: () => AuthContext = () => SUPERVISOR) {
  const cases = new InMemoryCaseRepository();
  const timelineRecorder = new InMemoryTimelineRecorder();
  const caseNotes = new InMemoryCaseNoteRepository();
  const auditRecorder = new InMemoryCaseManagementAuditRecorder();
  const routingRules = new InMemoryCaseRoutingRuleRepository();
  const clock = new FixedClock(NOW);
  const fraudConfig = new InMemoryOrganizationFraudConfigRepository();
  const slaTracking = new InMemoryCaseSlaTrackingRepository();
  const unitOfWork = new PassthroughUnitOfWork();

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
      assigneeDirectory: new InMemoryAssigneeDirectory(),
      notificationSender: new InMemoryCaseManagementNotificationSender(),
    }),
    listCases: createListCasesUseCase({ cases }),
    getCase: createGetCaseUseCase({ cases }),
    getCaseTimeline: createGetCaseTimelineUseCase({ cases, timelineReader: timelineRecorder }),
    addCaseNote: createAddCaseNoteUseCase({ cases, notes: caseNotes, timelineRecorder, auditRecorder: auditRecorder, unitOfWork, clock, generateCaseNoteId, generateTimelineEventId }),
    listCaseNotes: createListCaseNotesUseCase({ cases, notes: caseNotes }),
    reopenCase: createReopenCaseUseCase({
      cases,
      slaTracking,
      fraudConfig,
      timelineRecorder,
      auditRecorder,
      unitOfWork,
      clock,
      generateTimelineEventId,
      generateCaseSlaTrackingId,
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

  return { app, cases, slaTracking, timelineRecorder, auditRecorder };
}

describe('caseRouter POST /cases/:caseId/reopen', () => {
  it('reopens a RESOLVED case for SUPERVISOR and resets dueDate', async () => {
    const { app, cases, slaTracking, auditRecorder, timelineRecorder } = buildApp();
    await cases.save(buildResolvedCase());
    await slaTracking.save(
      CaseSlaTracking.create({
        id: generateCaseSlaTrackingId(),
        caseId: CASE_ID,
        dueDate: OLD_DUE,
        now: NOW,
      }),
    );

    const response = await request(app)
      .post(`/api/v1/cases/${CASE_ID}/reopen`)
      .send({ targetStatus: 'OPEN', justification: 'Customer appeal accepted' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: CASE_ID,
      status: 'OPEN',
      dueDate: EXPECTED_DUE_ISO,
    });
    expect(auditRecorder.all()[0]?.action).toBe('REOPEN_CASE');
    expect(timelineRecorder.all()[0]?.eventType).toBe('CASE_REOPENED');
    expect(slaTracking.all()[0]?.status).toBe('ON_TRACK');
  });

  it('returns 403 FORBIDDEN_ROLE for ANALYST', async () => {
    const { app, cases } = buildApp(() => ANALYST);
    await cases.save(buildResolvedCase());

    const response = await request(app)
      .post(`/api/v1/cases/${CASE_ID}/reopen`)
      .send({ targetStatus: 'OPEN', justification: 'Nope' });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN_ROLE');
  });

  it('returns 404 CASE_NOT_FOUND for a soft-deleted case', async () => {
    const { app, cases } = buildApp();
    await cases.save(buildResolvedCase(true));

    const response = await request(app)
      .post(`/api/v1/cases/${CASE_ID}/reopen`)
      .send({ targetStatus: 'OPEN', justification: 'Still deleted' });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('CASE_NOT_FOUND');
  });

  it('returns 400 when justification is missing', async () => {
    const { app, cases } = buildApp();
    await cases.save(buildResolvedCase());

    const response = await request(app)
      .post(`/api/v1/cases/${CASE_ID}/reopen`)
      .send({ targetStatus: 'OPEN' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
  });

  it('returns 400 when targetStatus is invalid', async () => {
    const { app } = buildApp();

    const response = await request(app)
      .post(`/api/v1/cases/${CASE_ID}/reopen`)
      .send({ targetStatus: 'RESOLVED', justification: 'Bad target' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
  });
});
