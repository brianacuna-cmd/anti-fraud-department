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
import { createListCasesUseCase } from '../../../../src/modules/case-management/application/ListCases.js';
import { createGetCaseUseCase } from '../../../../src/modules/case-management/application/GetCase.js';
import { createGetCaseTimelineUseCase } from '../../../../src/modules/case-management/application/GetCaseTimeline.js';
import { createAddCaseNoteUseCase } from '../../../../src/modules/case-management/application/AddCaseNote.js';
import { createListCaseNotesUseCase } from '../../../../src/modules/case-management/application/ListCaseNotes.js';
import { InMemoryResolutionRepository } from '../../../helpers/case-management/InMemoryResolutionRepository.js';
import { InMemoryAnalystDecisionRepository } from '../../../helpers/case-management/InMemoryAnalystDecisionRepository.js';
import { InMemoryEnforcementActionRepository } from '../../../helpers/case-management/InMemoryEnforcementActionRepository.js';
import { generateResolutionId } from '../../../../src/modules/case-management/domain/model/value-objects/ResolutionId.js';
import { createResolveCaseUseCase } from '../../../../src/modules/case-management/application/ResolveCase.js';
import { generateOutboxEventId } from '../../../../src/shared/outbox/OutboxEventId.js';
import { InMemoryOutboxEventRepository } from '../../../helpers/case-management/InMemoryOutboxEventRepository.js';
import { createArchiveCaseUseCase } from '../../../../src/modules/case-management/application/ArchiveCase.js';
import { createStartReviewUseCase } from '../../../../src/modules/case-management/application/StartReview.js';
import { InMemoryCaseNoteRepository } from '../../../helpers/case-management/InMemoryCaseNoteRepository.js';
import { generateCaseNoteId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseNoteId.js';
import { createReopenCaseUseCase } from '../../../../src/modules/case-management/application/ReopenCase.js';
import { createUpdateCasePriorityTagsUseCase } from '../../../../src/modules/case-management/application/UpdateCasePriorityTags.js';
import { createBulkCaseActionUseCase } from '../../../../src/modules/case-management/application/BulkCaseAction.js';
import { ZenRoutingEngine } from '../../../../src/modules/case-management/infrastructure/adapters/outbound/zen/ZenRoutingEngine.js';
import { InMemoryCaseRepository } from '../../../helpers/case-management/InMemoryCaseRepository.js';
import { InMemoryTimelineRecorder } from '../../../helpers/case-management/InMemoryTimelineRecorder.js';
import { InMemoryCaseManagementAuditRecorder } from '../../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';
import { InMemoryCaseManagementNotificationSender } from '../../../helpers/case-management/InMemoryCaseManagementNotificationSender.js';
import { InMemoryCaseRoutingRuleRepository } from '../../../helpers/case-management/InMemoryCaseRoutingRuleRepository.js';
import { InMemoryOrganizationFraudConfigRepository } from '../../../helpers/case-management/InMemoryOrganizationFraudConfigRepository.js';
import { InMemoryCaseSlaTrackingRepository } from '../../../helpers/case-management/InMemoryCaseSlaTrackingRepository.js';
import { InMemoryAssigneeDirectory } from '../../../helpers/case-management/InMemoryAssigneeDirectory.js';
import { AllowAllAssigneeDirectory } from '../../../helpers/case-management/AllowAllAssigneeDirectory.js';
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
const EARLY = fromDate(new Date('2026-01-02T00:00:00.000Z'));
const MID = fromDate(new Date('2026-01-03T00:00:00.000Z'));
const LATE = fromDate(new Date('2026-01-04T00:00:00.000Z'));

function buildApp(actorPerRequest: () => AuthContext = () => ORG_1_ANALYST) {
  const cases = new InMemoryCaseRepository();
  const timelineRecorder = new InMemoryTimelineRecorder();
  const caseNotes = new InMemoryCaseNoteRepository();
  const resolutions = new InMemoryResolutionRepository();
  const auditRecorder = new InMemoryCaseManagementAuditRecorder();
  const routingRules = new InMemoryCaseRoutingRuleRepository();
  const clock = new FixedClock(NOW);
  const fraudConfig = new InMemoryOrganizationFraudConfigRepository();
  const slaTracking = new InMemoryCaseSlaTrackingRepository();

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
    assigneeDirectory: new AllowAllAssigneeDirectory(),
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
    getCaseAnalysisPack: async () => {
      throw new Error('unused');
    },
    putAgentBrief: async () => {
      throw new Error('unused');
    },
    addCaseNote: createAddCaseNoteUseCase({ cases, notes: caseNotes, timelineRecorder, auditRecorder: auditRecorder, unitOfWork, clock, generateCaseNoteId, generateTimelineEventId }),
    listCaseNotes: createListCaseNotesUseCase({ cases, notes: caseNotes }),
    resolveCase: createResolveCaseUseCase({
      outbox: new InMemoryOutboxEventRepository(),
      generateOutboxEventId, cases, resolutions, timelineRecorder, auditRecorder: auditRecorder, unitOfWork, clock, generateResolutionId, generateTimelineEventId,
      decisions: new InMemoryAnalystDecisionRepository(),
      enforcementActions: new InMemoryEnforcementActionRepository(),
    }),
    archiveCase: createArchiveCaseUseCase({ cases, resolutions, timelineRecorder, auditRecorder: auditRecorder, unitOfWork, clock, generateResolutionId, generateTimelineEventId }),
    startReview: createStartReviewUseCase({ cases, timelineRecorder, auditRecorder: auditRecorder, unitOfWork, clock, generateTimelineEventId }),
    bulkCaseAction: createBulkCaseActionUseCase({
      cases,
      timelineRecorder,
      auditRecorder,
      assigneeDirectory: new InMemoryAssigneeDirectory(),
      unitOfWork,
      clock,
      generateTimelineEventId,
    }),
    updateCasePriorityTags: createUpdateCasePriorityTagsUseCase({
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

  return { app, cases };
}

describe('GET /api/v1/cases (inbox list)', () => {
  it('returns a filtered page of non-deleted cases for the tenant', async () => {
    const { app, cases } = buildApp();
    const assignee = oid('analyst-2');

    await cases.save(
      Case.rehydrate({
        ...Case.create({
          id: createCaseId(oid('inbox-match')),
          organizationId: ORG_1,
          customerId: 'c1',
          riskScore: createRiskScore(70),
          priority: 'HIGH',
          tags: ['fraud', 'wire'],
          now: NOW,
        })
          .reassign(createAssignedTo('USER', assignee), NOW)
          .withDueDate(MID, NOW)
          .toProps(),
        status: 'OPEN',
      }),
    );
    await cases.save(
      Case.create({
        id: createCaseId(oid('inbox-other')),
        organizationId: ORG_1,
        customerId: 'c2',
        riskScore: createRiskScore(10),
        priority: 'LOW',
        now: NOW,
      }).withDueDate(EARLY, NOW),
    );
    await cases.save(
      Case.rehydrate({
        ...Case.create({
          id: createCaseId(oid('inbox-deleted')),
          organizationId: ORG_1,
          customerId: 'c3',
          riskScore: createRiskScore(70),
          priority: 'HIGH',
          tags: ['fraud', 'wire'],
          now: NOW,
        })
          .reassign(createAssignedTo('USER', assignee), NOW)
          .withDueDate(MID, NOW)
          .toProps(),
        deletedAt: NOW,
      }),
    );

    const response = await request(app).get('/api/v1/cases').query({
      status: 'OPEN',
      priority: 'HIGH',
      assignedTo: assignee,
      riskScoreMin: '50',
      riskScoreMax: '80',
      tags: ['fraud', 'wire'],
      dueAfter: EARLY,
      dueBefore: LATE,
      limit: '10',
      offset: '0',
    });

    expect(response.status).toBe(200);
    expect(response.body.total).toBe(1);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0].id).toBe(oid('inbox-match'));
    expect(response.body.items[0].dueDate).toBe(MID);
  });

  it('filters the inbox by customerId and returns only matching tenant cases', async () => {
    const { app, cases } = buildApp();
    await cases.save(
      Case.create({
        id: createCaseId(oid('cust-a-case')),
        organizationId: ORG_1,
        customerId: 'cust-a',
        riskScore: createRiskScore(10),
        priority: 'LOW',
        now: NOW,
      }),
    );
    await cases.save(
      Case.create({
        id: createCaseId(oid('cust-b-case')),
        organizationId: ORG_1,
        customerId: 'cust-b',
        riskScore: createRiskScore(10),
        priority: 'LOW',
        now: NOW,
      }),
    );

    const match = await request(app).get('/api/v1/cases').query({ customerId: 'cust-a' });
    expect(match.status).toBe(200);
    expect(match.body.total).toBe(1);
    expect(match.body.items).toHaveLength(1);
    expect(match.body.items[0].id).toBe(oid('cust-a-case'));
    expect(match.body.items[0].customerId).toBe('cust-a');

    const empty = await request(app).get('/api/v1/cases').query({ customerId: 'cust-none' });
    expect(empty.status).toBe(200);
    expect(empty.body.total).toBe(0);
    expect(empty.body.items).toEqual([]);
  });

  it('orders null dueDate after non-null dueDates', async () => {
    const { app, cases } = buildApp();
    await cases.save(
      Case.create({
        id: createCaseId(oid('due-null')),
        organizationId: ORG_1,
        customerId: 'c1',
        riskScore: createRiskScore(1),
        priority: 'LOW',
        now: NOW,
      }),
    );
    await cases.save(
      Case.create({
        id: createCaseId(oid('due-early')),
        organizationId: ORG_1,
        customerId: 'c2',
        riskScore: createRiskScore(1),
        priority: 'LOW',
        now: NOW,
      }).withDueDate(EARLY, NOW),
    );

    const response = await request(app).get('/api/v1/cases').query({ limit: '10', offset: '0' });

    expect(response.status).toBe(200);
    expect(response.body.items.map((item: { id: string }) => item.id)).toEqual([
      oid('due-early'),
      oid('due-null'),
    ]);
  });

  it('returns 400 for invalid query params', async () => {
    const { app } = buildApp();

    const response = await request(app).get('/api/v1/cases').query({ limit: '0' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
  });
});
