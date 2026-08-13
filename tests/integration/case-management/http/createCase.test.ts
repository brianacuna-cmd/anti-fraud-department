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
import { createRouteCaseUseCase } from '../../../../src/modules/case-management/application/RouteCase.js';
import { ZenRoutingEngine } from '../../../../src/modules/case-management/infrastructure/adapters/outbound/zen/ZenRoutingEngine.js';
import { InMemoryCaseRepository } from '../../../helpers/case-management/InMemoryCaseRepository.js';
import { InMemoryTimelineRecorder } from '../../../helpers/case-management/InMemoryTimelineRecorder.js';
import { InMemoryCaseManagementAuditRecorder } from '../../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';
import { InMemoryCaseRoutingRuleRepository } from '../../../helpers/case-management/InMemoryCaseRoutingRuleRepository.js';
import { InMemoryOrganizationFraudConfigRepository } from '../../../helpers/case-management/InMemoryOrganizationFraudConfigRepository.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/case-management/infrastructure/PassthroughUnitOfWork.js';
import { generateCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { generateTimelineEventId } from '../../../../src/modules/case-management/domain/model/value-objects/TimelineEventId.js';
import { CaseRoutingRule } from '../../../../src/modules/case-management/domain/model/aggregates/CaseRoutingRule.js';
import { generateCaseRoutingRuleId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseRoutingRuleId.js';
import { OrganizationFraudConfig } from '../../../../src/modules/case-management/domain/model/aggregates/OrganizationFraudConfig.js';
import { generateOrganizationFraudConfigId } from '../../../../src/modules/case-management/domain/model/value-objects/OrganizationFraudConfigId.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';

const ORG_1_ANALYST = createAuthContext({ userId: oid('analyst-1'), organizationId: oid('org-1'), actorType: 'USER' });

/** JDM: riskScore > 80 AND status == OPEN -> targetUserId "auto-user". */
function highRiskToUserJdm(): Record<string, unknown> {
  return {
    contentType: 'application/vnd.gorules.decision',
    nodes: [
      { id: 'input', type: 'inputNode', name: 'Request', position: { x: 0, y: 0 } },
      {
        id: 'table',
        type: 'decisionTableNode',
        name: 'Routing',
        position: { x: 200, y: 0 },
        content: {
          hitPolicy: 'first',
          inputs: [
            { id: 'i1', name: 'Risk Score', field: 'riskScore' },
            { id: 'i2', name: 'Status', field: 'status' },
          ],
          outputs: [{ id: 'o1', name: 'Target User', field: 'targetUserId' }],
          rules: [{ _id: 'r1', i1: '> 80', i2: '"OPEN"', o1: '"auto-user"' }],
        },
      },
      { id: 'output', type: 'outputNode', name: 'Response', position: { x: 400, y: 0 } },
    ],
    edges: [
      { id: 'e1', sourceId: 'input', targetId: 'table' },
      { id: 'e2', sourceId: 'table', targetId: 'output' },
    ],
  };
}

function buildApp(actorPerRequest: () => AuthContext) {
  const cases = new InMemoryCaseRepository();
  const timelineRecorder = new InMemoryTimelineRecorder();
  const auditRecorder = new InMemoryCaseManagementAuditRecorder();
  const routingRules = new InMemoryCaseRoutingRuleRepository();
  const clock = new SystemClock();
  const fraudConfig = new InMemoryOrganizationFraudConfigRepository();
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

  const router = caseRouter({
    createCase: createCreateCaseUseCase({
      cases,
      timelineRecorder,
      unitOfWork: new PassthroughUnitOfWork(),
      clock,
      generateCaseId,
      generateTimelineEventId,
      auditRecorder,
      routeCase,
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

  return { app, cases, timelineRecorder, auditRecorder, routingRules, fraudConfig };
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

  it('T1 auto-routing: assigns the case to the rule target and appends an ASSIGNED timeline entry on creation', async () => {
    const { app, routingRules, timelineRecorder } = buildApp(() => ORG_1_ANALYST);
    routingRules.add(
      CaseRoutingRule.create({
        id: generateCaseRoutingRuleId(),
        organizationId: oid('org-1'),
        name: 'high-risk -> auto-user',
        conditions: highRiskToUserJdm(),
        conditionsVersion: 1,
        now: fromDate(new Date('2026-01-01T00:00:00.000Z')),
      }),
    );

    const response = await request(app)
      .post('/api/v1/cases')
      .send({ customerId: 'customer-1', riskScore: 90, priority: 'HIGH' });

    expect(response.status).toBe(201);
    expect(response.body.assignedTo).toEqual({ type: 'USER', id: 'auto-user' });
    const events = timelineRecorder.all();
    expect(events.map((e) => e.eventType).sort()).toEqual(['ASSIGNED', 'CASE_CREATED']);
  });

  it('T1 auto-routing: leaves the case unassigned when no active rule matches', async () => {
    const { app, routingRules } = buildApp(() => ORG_1_ANALYST);
    routingRules.add(
      CaseRoutingRule.create({
        id: generateCaseRoutingRuleId(),
        organizationId: oid('org-1'),
        name: 'high-risk -> auto-user',
        conditions: highRiskToUserJdm(),
        conditionsVersion: 1,
        now: fromDate(new Date('2026-01-01T00:00:00.000Z')),
      }),
    );

    const response = await request(app)
      .post('/api/v1/cases')
      .send({ customerId: 'customer-1', riskScore: 20, priority: 'LOW' });

    expect(response.status).toBe(201);
    expect(response.body.assignedTo).toBeNull();
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

  it('T1 auto-routing: the REASSIGN_CASE audit row traces back to the rule version that assigned the case', async () => {
    const { app, routingRules, auditRecorder } = buildApp(() => ORG_1_ANALYST);
    const rule = CaseRoutingRule.create({
      id: generateCaseRoutingRuleId(),
      organizationId: oid('org-1'),
      name: 'high-risk -> auto-user',
      conditions: highRiskToUserJdm(),
      conditionsVersion: 4,
      now: fromDate(new Date('2026-01-01T00:00:00.000Z')),
    });
    routingRules.add(rule);

    await request(app).post('/api/v1/cases').send({ customerId: 'customer-1', riskScore: 90, priority: 'HIGH' });

    const routed = auditRecorder.all().find((event) => event.action === 'REASSIGN_CASE');
    expect(routed?.detail).toMatchObject({
      trigger: 'AUTO_ROUTING',
      ruleId: rule.id,
      conditionsVersion: 4,
      assignedToId: 'auto-user',
      assignedToType: 'USER',
    });
  });

  it('T1 auto-routing: a malformed JDM is skipped so the case is still created (201, unassigned)', async () => {
    const { app, routingRules, auditRecorder } = buildApp(() => ORG_1_ANALYST);
    routingRules.add(
      CaseRoutingRule.create({
        id: generateCaseRoutingRuleId(),
        organizationId: oid('org-1'),
        name: 'broken-rule',
        conditions: { nodes: 'not-a-jdm-graph' },
        conditionsVersion: 1,
        now: fromDate(new Date('2026-01-01T00:00:00.000Z')),
      }),
    );

    const response = await request(app)
      .post('/api/v1/cases')
      .send({ customerId: 'customer-1', riskScore: 90, priority: 'HIGH' });

    expect(response.status).toBe(201);
    expect(response.body.assignedTo).toBeNull();
    expect(auditRecorder.all().map((event) => event.action)).toContain('ROUTING_RULE_EVALUATION_FAILED');
  });

  it('T1 auto-routing: featureFlags.autoRouting=false leaves the case unassigned despite a matching rule', async () => {
    const { app, routingRules, fraudConfig } = buildApp(() => ORG_1_ANALYST);
    routingRules.add(
      CaseRoutingRule.create({
        id: generateCaseRoutingRuleId(),
        organizationId: oid('org-1'),
        name: 'high-risk -> auto-user',
        conditions: highRiskToUserJdm(),
        conditionsVersion: 1,
        now: fromDate(new Date('2026-01-01T00:00:00.000Z')),
      }),
    );
    fraudConfig.seed(
      OrganizationFraudConfig.create({
        id: generateOrganizationFraudConfigId(),
        organizationId: oid('org-1'),
        slaLowMinutes: 60,
        slaMediumMinutes: 60,
        slaHighMinutes: 60,
        slaCriticalMinutes: 60,
        riskThresholdLow: 25,
        riskThresholdMedium: 50,
        riskThresholdHigh: 75,
        riskThresholdCritical: 90,
        featureFlags: { autoRouting: false },
        now: fromDate(new Date('2026-01-01T00:00:00.000Z')),
      }),
    );

    const response = await request(app)
      .post('/api/v1/cases')
      .send({ customerId: 'customer-1', riskScore: 90, priority: 'HIGH' });

    expect(response.status).toBe(201);
    expect(response.body.assignedTo).toBeNull();
  });
});
