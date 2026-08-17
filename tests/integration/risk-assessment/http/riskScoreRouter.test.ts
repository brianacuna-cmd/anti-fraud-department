import { oid } from '../../../support/oid.js';
import { Router, type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { createApp } from '../../../../src/shared/http/createApp.js';
import { createErrorHandler } from '../../../../src/shared/http/errorHandler.js';
import { attachAuthContext } from '../../../../src/shared/http/requestAuthContext.js';
import { createAuthContext, type AuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { SystemClock } from '../../../../src/shared/time/SystemClock.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { riskAssessmentErrorStatus } from '../../../../src/modules/risk-assessment/infrastructure/adapters/inbound/http/errorStatus.js';
import { riskScoreRouter } from '../../../../src/modules/risk-assessment/infrastructure/adapters/inbound/http/riskScoreRouter.js';
import { createCalculateRiskScoreUseCase } from '../../../../src/modules/risk-assessment/application/CalculateRiskScore.js';
import type {
  RiskScoringEngine,
  RiskScoringEvaluation,
} from '../../../../src/modules/risk-assessment/domain/ports/RiskScoringEngine.js';
import { RiskScoringRule } from '../../../../src/modules/risk-assessment/domain/model/aggregates/RiskScoringRule.js';
import { generateRiskScoringRuleId } from '../../../../src/modules/risk-assessment/domain/model/value-objects/RiskScoringRuleId.js';
import { InMemoryRiskScoringRuleRepository } from '../../../helpers/risk-assessment/InMemoryRiskScoringRuleRepository.js';
import { InMemoryRiskAssessmentAuditRecorder } from '../../../helpers/risk-assessment/InMemoryRiskAssessmentAuditRecorder.js';
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
import { generateResolutionId } from '../../../../src/modules/case-management/domain/model/value-objects/ResolutionId.js';
import { createResolveCaseUseCase } from '../../../../src/modules/case-management/application/ResolveCase.js';
import { createArchiveCaseUseCase } from '../../../../src/modules/case-management/application/ArchiveCase.js';
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
import { OrganizationFraudConfig } from '../../../../src/modules/case-management/domain/model/aggregates/OrganizationFraudConfig.js';
import { generateOrganizationFraudConfigId } from '../../../../src/modules/case-management/domain/model/value-objects/OrganizationFraudConfigId.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/case-management/infrastructure/PassthroughUnitOfWork.js';
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

class ThrowingRiskScoringEngine implements RiskScoringEngine {
  readonly calls: unknown[] = [];

  async evaluate(
    conditions: Readonly<Record<string, unknown>>,
    context: Readonly<Record<string, unknown>>,
  ): Promise<RiskScoringEvaluation> {
    this.calls.push({ conditions, context });
    throw new Error('invalid JDM graph');
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

function buildApp(actorPerRequest: () => AuthContext, engine: RiskScoringEngine, seedRule = true) {
  const scoringRules = new InMemoryRiskScoringRuleRepository();
  const rule = RiskScoringRule.create({
    id: generateRiskScoringRuleId(),
    organizationId: oid('org-1'),
    name: 'dispute-score',
    conditions: { graph: 'oldest' },
    conditionsVersion: 4,
    status: 'ACTIVE',
    now: NOW,
  });
  if (seedRule) {
    scoringRules.add(rule);
  }
  const auditRecorder = new InMemoryRiskAssessmentAuditRecorder();
  const calculateRiskScore = createCalculateRiskScoreUseCase({
    scoringRules,
    scoringEngine: engine,
    auditRecorder,
  });

  const cases = new InMemoryCaseRepository();
  const timelineRecorder = new InMemoryTimelineRecorder();
  const caseNotes = new InMemoryCaseNoteRepository();
  const resolutions = new InMemoryResolutionRepository();
  const caseAuditRecorder = new InMemoryCaseManagementAuditRecorder();
  const routingRules = new InMemoryCaseRoutingRuleRepository();
  const clock = new SystemClock();
  const fraudConfig = new InMemoryOrganizationFraudConfigRepository();
  const slaTracking = new InMemoryCaseSlaTrackingRepository();
  const unitOfWork = new PassthroughUnitOfWork();
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

  const scoresRouter = riskScoreRouter({ calculateRiskScore });
  const casesRouter = caseRouter({
    createCase: createCreateCaseUseCase({
      cases,
      timelineRecorder,
      unitOfWork,
      clock,
      generateCaseId,
      generateTimelineEventId,
      auditRecorder: caseAuditRecorder,
      routeCase,
      calculateSla,
    }),
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
  mounted.use(casesRouter);

  const app = createApp({
    routers: [{ path: '/api/v1', router: mounted }],
    errorHandler: createErrorHandler({ ...caseManagementErrorStatus, ...riskAssessmentErrorStatus }),
  });

  return { app, engine, rule, auditRecorder };
}

describe('riskScoreRouter (e2e, in-memory repository)', () => {
  it('POST /risk-scores scores a camelCase event and returns provenance without echoing rawPayload', async () => {
    const engine = new ScriptedRiskScoringEngine({ riskScore: 72 });
    const { app, rule } = buildApp(() => ORG_1_ANALYST, engine);

    const response = await request(app).post('/api/v1/risk-scores').send(validEvent());

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      riskScore: 72,
      ruleId: rule.id,
      name: 'dispute-score',
      conditionsVersion: 4,
    });
    expect(response.body).not.toHaveProperty('rawPayload');
    expect(JSON.stringify(response.body)).not.toContain('do-not-echo');
    expect(engine.calls).toHaveLength(1);
    expect(engine.calls[0]?.context).not.toHaveProperty('rawPayload');
    expect(engine.calls[0]?.context.amountCents).toBe(2500);
  });

  it('POST /risk-scores returns a different integer score from a different engine result', async () => {
    const engine = new ScriptedRiskScoringEngine({ riskScore: 15 });
    const { app } = buildApp(() => ORG_1_ANALYST, engine);

    const response = await request(app)
      .post('/api/v1/risk-scores')
      .send(validEvent({ amountCents: 100, providerEventType: 'charge.succeeded' }));

    expect(response.status).toBe(200);
    expect(response.body.riskScore).toBe(15);
    expect(engine.calls[0]?.context.providerEventType).toBe('charge.succeeded');
  });

  it('POST /risk-scores rejects snake_case amount_cents with 400 INVARIANT_VIOLATION', async () => {
    const engine = new ScriptedRiskScoringEngine({ riskScore: 10 });
    const { app } = buildApp(() => ORG_1_ANALYST, engine);
    const { amountCents: _omitted, ...rest } = validEvent();

    const response = await request(app)
      .post('/api/v1/risk-scores')
      .send({ ...rest, amount_cents: 2500 });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
    expect(engine.calls).toHaveLength(0);
  });

  it('POST /risk-scores rejects a missing provider with 400', async () => {
    const engine = new ScriptedRiskScoringEngine({ riskScore: 10 });
    const { app } = buildApp(() => ORG_1_ANALYST, engine);
    const { provider: _omitted, ...rest } = validEvent();

    const response = await request(app).post('/api/v1/risk-scores').send(rest);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
  });

  it('POST /risk-scores returns 404 SCORING_RULE_NOT_FOUND when no ACTIVE rule exists', async () => {
    const engine = new ScriptedRiskScoringEngine({ riskScore: 10 });
    const { app } = buildApp(() => ORG_1_ANALYST, engine, false);

    const response = await request(app).post('/api/v1/risk-scores').send(validEvent());

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('SCORING_RULE_NOT_FOUND');
    expect(engine.calls).toHaveLength(0);
  });

  it('POST /risk-scores returns 400 when evaluation fails closed', async () => {
    const engine = new ThrowingRiskScoringEngine();
    const { app } = buildApp(() => ORG_1_ANALYST, engine);

    const response = await request(app).post('/api/v1/risk-scores').send(validEvent());

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
  });

  it('POST /risk-scores rejects a caller with no organization context with 403 FORBIDDEN_CROSS_TENANT', async () => {
    const platformAdminNoOrg = createAuthContext({
      userId: 'pa-1',
      organizationId: null,
      isPlatformAdmin: true,
    });
    const engine = new ScriptedRiskScoringEngine({ riskScore: 10 });
    const { app } = buildApp(() => platformAdminNoOrg, engine);

    const response = await request(app).post('/api/v1/risk-scores').send(validEvent());

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN_CROSS_TENANT');
    expect(engine.calls).toHaveLength(0);
  });

  it('POST /cases still requires manual riskScore and does not call the scoring engine', async () => {
    const engine = new ScriptedRiskScoringEngine({ riskScore: 99 });
    const { app } = buildApp(() => ORG_1_ANALYST, engine);

    const missing = await request(app).post('/api/v1/cases').send({ customerId: 'customer-1' });

    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('INVARIANT_VIOLATION');
    expect(engine.calls).toHaveLength(0);

    const created = await request(app)
      .post('/api/v1/cases')
      .send({ customerId: 'customer-1', riskScore: 40 });

    expect(created.status).toBe(201);
    expect(created.body.riskScore).toBe(40);
    expect(engine.calls).toHaveLength(0);
  });
});
