import { oid } from '../../../support/oid.js';
import { Router, type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { createApp } from '../../../../src/shared/http/createApp.js';
import { createErrorHandler } from '../../../../src/shared/http/errorHandler.js';
import { attachAuthContext } from '../../../../src/shared/http/requestAuthContext.js';
import { createAuthContext, type AuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { riskAssessmentErrorStatus } from '../../../../src/modules/risk-assessment/infrastructure/adapters/inbound/http/errorStatus.js';
import { caseManagementErrorStatus } from '../../../../src/modules/case-management/infrastructure/adapters/inbound/http/errorStatus.js';
import { riskScoreRouter } from '../../../../src/modules/risk-assessment/infrastructure/adapters/inbound/http/riskScoreRouter.js';
import { scoreToCaseProcessRouter } from '../../../../src/composition/scoreToCaseProcessRouter.js';
import { createScoreToCaseOrchestrator } from '../../../../src/composition/scoreToCaseOrchestrator.js';
import { createCalculateRiskScoreUseCase } from '../../../../src/modules/risk-assessment/application/CalculateRiskScore.js';
import type {
  RiskScoringEngine,
  RiskScoringEvaluation,
} from '../../../../src/modules/risk-assessment/domain/ports/RiskScoringEngine.js';
import { RiskScoringRule } from '../../../../src/modules/risk-assessment/domain/model/aggregates/RiskScoringRule.js';
import { generateRiskScoringRuleId } from '../../../../src/modules/risk-assessment/domain/model/value-objects/RiskScoringRuleId.js';
import { InMemoryRiskScoringRuleRepository } from '../../../helpers/risk-assessment/InMemoryRiskScoringRuleRepository.js';
import { InMemoryRiskAssessmentAuditRecorder } from '../../../helpers/risk-assessment/InMemoryRiskAssessmentAuditRecorder.js';
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
import { generateResolutionId } from '../../../../src/modules/case-management/domain/model/value-objects/ResolutionId.js';
import { createResolveCaseUseCase } from '../../../../src/modules/case-management/application/ResolveCase.js';
import { createArchiveCaseUseCase } from '../../../../src/modules/case-management/application/ArchiveCase.js';
import { createStartReviewUseCase } from '../../../../src/modules/case-management/application/StartReview.js';
import { InMemoryCaseNoteRepository } from '../../../helpers/case-management/InMemoryCaseNoteRepository.js';
import { generateCaseNoteId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseNoteId.js';
import { createReopenCaseUseCase } from '../../../../src/modules/case-management/application/ReopenCase.js';
import { createGetOrganizationFraudConfigUseCase } from '../../../../src/modules/case-management/application/GetOrganizationFraudConfig.js';
import { ZenRoutingEngine } from '../../../../src/modules/case-management/infrastructure/adapters/outbound/zen/ZenRoutingEngine.js';
import { InMemoryCaseRepository } from '../../../helpers/case-management/InMemoryCaseRepository.js';
import { InMemoryTimelineRecorder } from '../../../helpers/case-management/InMemoryTimelineRecorder.js';
import { InMemoryCaseManagementAuditRecorder } from '../../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';
import { InMemoryCaseManagementNotificationSender } from '../../../helpers/case-management/InMemoryCaseManagementNotificationSender.js';
import { InMemoryCaseRoutingRuleRepository } from '../../../helpers/case-management/InMemoryCaseRoutingRuleRepository.js';
import { InMemoryOrganizationFraudConfigRepository } from '../../../helpers/case-management/InMemoryOrganizationFraudConfigRepository.js';
import { InMemoryCaseSlaTrackingRepository } from '../../../helpers/case-management/InMemoryCaseSlaTrackingRepository.js';
import { InMemoryAssigneeDirectory } from '../../../helpers/case-management/InMemoryAssigneeDirectory.js';
import { OrganizationFraudConfig } from '../../../../src/modules/case-management/domain/model/aggregates/OrganizationFraudConfig.js';
import { generateOrganizationFraudConfigId } from '../../../../src/modules/case-management/domain/model/value-objects/OrganizationFraudConfigId.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/case-management/infrastructure/PassthroughUnitOfWork.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { generateCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { generateTimelineEventId } from '../../../../src/modules/case-management/domain/model/value-objects/TimelineEventId.js';
import { generateCaseSlaTrackingId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseSlaTrackingId.js';

const ORG_1_ANALYST = createAuthContext({
  userId: oid('analyst-1'),
  organizationId: oid('org-1'),
  actorType: 'USER',
});

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

class ScriptedRiskScoringEngine implements RiskScoringEngine {
  readonly calls: Array<{
    conditions: Readonly<Record<string, unknown>>;
    context: Readonly<Record<string, unknown>>;
  }> = [];

  constructor(private readonly evaluation: { riskScore: number; hits?: readonly unknown[] }) {}

  async evaluate(
    conditions: Readonly<Record<string, unknown>>,
    context: Readonly<Record<string, unknown>>,
  ): Promise<RiskScoringEvaluation> {
    this.calls.push({ conditions, context });
    return {
      riskScore: this.evaluation.riskScore,
      hits: this.evaluation.hits ?? [],
    };
  }
}

function validEvent(overrides: Record<string, unknown> = {}) {
  return {
    provider: 'stripe',
    providerEventType: 'CHARGEBACK',
    caseCustomerId: 'cust-1',
    amountCents: 2500,
    currency: 'USD',
    riskSignals: { providerRiskScore: 80 },
    createdAt: '2026-01-01T00:00:00.000Z',
    rawPayload: { secret: 'do-not-echo' },
    ...overrides,
  };
}

function buildApp(
  actorPerRequest: () => AuthContext,
  engine: RiskScoringEngine,
  options: { seedRule?: boolean; seedFraudConfig?: boolean } = {},
) {
  const seedRule = options.seedRule !== false;
  const seedFraudConfig = options.seedFraudConfig !== false;

  const scoringRules = new InMemoryRiskScoringRuleRepository();
  const rule = RiskScoringRule.create({
    id: generateRiskScoringRuleId(),
    organizationId: oid('org-1'),
    name: 'dispute-score',
    conditions: { graph: 'active' },
    conditionsVersion: 4,
    status: 'ACTIVE',
    now: NOW,
  });
  if (seedRule) {
    scoringRules.add(rule);
  }
  const riskAudit = new InMemoryRiskAssessmentAuditRecorder();
  const calculateRiskScore = createCalculateRiskScoreUseCase({
    scoringRules,
    scoringEngine: engine,
    auditRecorder: riskAudit,
  });

  const cases = new InMemoryCaseRepository();
  const timelineRecorder = new InMemoryTimelineRecorder();
  const caseNotes = new InMemoryCaseNoteRepository();
  const resolutions = new InMemoryResolutionRepository();
  const caseAuditRecorder = new InMemoryCaseManagementAuditRecorder();
  const routingRules = new InMemoryCaseRoutingRuleRepository();
  const clock = new FixedClock(NOW);
  const fraudConfig = new InMemoryOrganizationFraudConfigRepository();
  const slaTracking = new InMemoryCaseSlaTrackingRepository();
  const unitOfWork = new PassthroughUnitOfWork();
  if (seedFraudConfig) {
    fraudConfig.seed(
      OrganizationFraudConfig.create({
        id: generateOrganizationFraudConfigId(),
        organizationId: oid('org-1'),
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
  }

  const routeCase = createRouteCaseUseCase({
    cases,
    routingRules,
    routingEngine: new ZenRoutingEngine(),
    timelineRecorder,
    auditRecorder: caseAuditRecorder,
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
  const createCase = createCreateCaseUseCase({
    cases,
    timelineRecorder,
    unitOfWork,
    clock,
    generateCaseId,
    generateTimelineEventId,
    auditRecorder: caseAuditRecorder,
    routeCase,
    calculateSla,
  });
  const getOrganizationFraudConfig = createGetOrganizationFraudConfigUseCase({
    repository: fraudConfig,
  });
  const processRiskScoreToCase = createScoreToCaseOrchestrator({
    calculateRiskScore,
    getOrganizationFraudConfig,
    createCase,
  });

  const scoresRouter = riskScoreRouter({ calculateRiskScore });
  const processRouter = scoreToCaseProcessRouter({ processRiskScoreToCase });
  const casesRouter = caseRouter({
    createCase,
    reassignCase: createReassignCaseUseCase({
      cases,
      timelineRecorder,
      auditRecorder: caseAuditRecorder,
      unitOfWork,
      clock,
      generateTimelineEventId,
      assigneeDirectory: new InMemoryAssigneeDirectory(),
      notificationSender: new InMemoryCaseManagementNotificationSender(),
    }),
    listCases: createListCasesUseCase({ cases }),
    getCase: createGetCaseUseCase({ cases }),
    getCaseTimeline: createGetCaseTimelineUseCase({ cases, timelineReader: timelineRecorder }),
    addCaseNote: createAddCaseNoteUseCase({ cases, notes: caseNotes, timelineRecorder, auditRecorder: caseAuditRecorder, unitOfWork, clock, generateCaseNoteId, generateTimelineEventId }),
    listCaseNotes: createListCaseNotesUseCase({ cases, notes: caseNotes }),
    resolveCase: createResolveCaseUseCase({ cases, resolutions, timelineRecorder, auditRecorder: caseAuditRecorder, unitOfWork, clock, generateResolutionId, generateTimelineEventId }),
    archiveCase: createArchiveCaseUseCase({ cases, resolutions, timelineRecorder, auditRecorder: caseAuditRecorder, unitOfWork, clock, generateResolutionId, generateTimelineEventId }),
    startReview: createStartReviewUseCase({ cases, timelineRecorder, auditRecorder: caseAuditRecorder, unitOfWork, clock, generateTimelineEventId }),
    reopenCase: createReopenCaseUseCase({
      cases,
      slaTracking,
      fraudConfig,
      timelineRecorder,
      auditRecorder: caseAuditRecorder,
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
  mounted.use(scoresRouter);
  mounted.use(processRouter);
  mounted.use(casesRouter);

  const app = createApp({
    routers: [{ path: '/api/v1', router: mounted }],
    errorHandler: createErrorHandler({ ...caseManagementErrorStatus, ...riskAssessmentErrorStatus }),
  });

  return { app, engine, rule, cases };
}

describe('POST /api/v1/risk-scores/process', () => {
  it('opens a case with HIGH priority and returns opened=true when score ≥ low', async () => {
    const engine = new ScriptedRiskScoringEngine({
      riskScore: 80,
      hits: [{ id: 'h1' }],
    });
    const { app, rule, cases } = buildApp(() => ORG_1_ANALYST, engine);

    const response = await request(app).post('/api/v1/risk-scores/process').send(validEvent());

    expect(response.status).toBe(200);
    expect(response.body.opened).toBe(true);
    expect(response.body.riskScore).toBe(80);
    expect(response.body.ruleId).toBe(rule.id);
    expect(response.body.conditionsVersion).toBe(4);
    expect(response.body.priority).toBe('HIGH');
    expect(typeof response.body.caseId).toBe('string');
    expect(response.body.caseId.length).toBeGreaterThan(0);

    const stored = cases.all();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.priority).toBe('HIGH');
    expect(stored[0]?.finturuCacheSnapshot).toMatchObject({
      ruleId: rule.id,
      conditionsVersion: 4,
      riskScore: 80,
      hits: [{ id: 'h1' }],
    });
    expect(stored[0]?.finturuCacheSnapshot?.event).not.toHaveProperty('rawPayload');
    expect(JSON.stringify(response.body)).not.toContain('do-not-echo');
  });

  it('returns opened=false and creates no case when score is below low', async () => {
    const engine = new ScriptedRiskScoringEngine({ riskScore: 10 });
    const { app, cases } = buildApp(() => ORG_1_ANALYST, engine);

    const response = await request(app).post('/api/v1/risk-scores/process').send(validEvent());

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      riskScore: 10,
      ruleId: expect.any(String),
      conditionsVersion: 4,
      opened: false,
    });
    expect(response.body).not.toHaveProperty('caseId');
    expect(response.body).not.toHaveProperty('priority');
    expect(cases.all()).toHaveLength(0);
  });

  it('fail-closes with 404 ORGANIZATION_FRAUD_CONFIG_NOT_FOUND when fraud config is missing', async () => {
    const engine = new ScriptedRiskScoringEngine({ riskScore: 80 });
    const { app, cases } = buildApp(() => ORG_1_ANALYST, engine, { seedFraudConfig: false });

    const response = await request(app).post('/api/v1/risk-scores/process').send(validEvent());

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('ORGANIZATION_FRAUD_CONFIG_NOT_FOUND');
    expect(cases.all()).toHaveLength(0);
  });

  it('fail-closes with 404 SCORING_RULE_NOT_FOUND when no ACTIVE rule exists', async () => {
    const engine = new ScriptedRiskScoringEngine({ riskScore: 80 });
    const { app, cases } = buildApp(() => ORG_1_ANALYST, engine, { seedRule: false });

    const response = await request(app).post('/api/v1/risk-scores/process').send(validEvent());

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('SCORING_RULE_NOT_FOUND');
    expect(cases.all()).toHaveLength(0);
    expect(engine.calls).toHaveLength(0);
  });

  it('POST /cases remains unchanged — no snapshot field required; scoring engine not called', async () => {
    const engine = new ScriptedRiskScoringEngine({ riskScore: 99 });
    const { app, cases } = buildApp(() => ORG_1_ANALYST, engine);

    const created = await request(app)
      .post('/api/v1/cases')
      .send({ customerId: 'customer-1', riskScore: 40, priority: 'MEDIUM' });

    expect(created.status).toBe(201);
    expect(created.body.riskScore).toBe(40);
    expect(created.body.priority).toBe('MEDIUM');
    expect(engine.calls).toHaveLength(0);
    expect(cases.all()[0]?.finturuCacheSnapshot).toBeNull();
  });
});
