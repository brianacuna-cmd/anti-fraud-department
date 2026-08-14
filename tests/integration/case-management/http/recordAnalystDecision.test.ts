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
import { enforcementRouter } from '../../../../src/modules/case-management/infrastructure/adapters/inbound/http/enforcementRouter.js';
import { createRecordAnalystDecisionUseCase } from '../../../../src/modules/case-management/application/RecordAnalystDecision.js';
import { InMemoryCaseRepository } from '../../../helpers/case-management/InMemoryCaseRepository.js';
import { InMemoryTimelineRecorder } from '../../../helpers/case-management/InMemoryTimelineRecorder.js';
import { InMemoryCaseManagementAuditRecorder } from '../../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';
import { InMemoryAnalystDecisionRepository } from '../../../helpers/case-management/InMemoryAnalystDecisionRepository.js';
import { InMemoryEnforcementActionRepository } from '../../../helpers/case-management/InMemoryEnforcementActionRepository.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/case-management/infrastructure/PassthroughUnitOfWork.js';
import { generateAnalystDecisionId } from '../../../../src/modules/case-management/domain/model/value-objects/AnalystDecisionId.js';
import { generateEnforcementActionId } from '../../../../src/modules/case-management/domain/model/value-objects/EnforcementActionId.js';
import { generateTimelineEventId } from '../../../../src/modules/case-management/domain/model/value-objects/TimelineEventId.js';
import { Case } from '../../../../src/modules/case-management/domain/model/aggregates/Case.js';
import { createCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { createRiskScore } from '../../../../src/modules/case-management/domain/model/value-objects/RiskScore.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_1 = oid('org-1');
const CASE_ID = createCaseId(oid('case-decision-http-1'));

const ANALYST = createAuthContext({
  userId: oid('analyst-1'),
  organizationId: ORG_1,
  actorType: 'USER',
  roleId: 'ANALYST',
});
const AUDITOR = createAuthContext({
  userId: oid('auditor-1'),
  organizationId: ORG_1,
  actorType: 'USER',
  roleId: 'AUDITOR',
});

function buildApp(actorPerRequest: () => AuthContext = () => ANALYST) {
  const cases = new InMemoryCaseRepository();
  const decisions = new InMemoryAnalystDecisionRepository();
  const enforcementActions = new InMemoryEnforcementActionRepository();
  const timelineRecorder = new InMemoryTimelineRecorder();
  const auditRecorder = new InMemoryCaseManagementAuditRecorder();
  const clock = new FixedClock(NOW);
  const unitOfWork = new PassthroughUnitOfWork();

  const router = enforcementRouter({
    recordAnalystDecision: createRecordAnalystDecisionUseCase({
      cases,
      decisions,
      enforcementActions,
      timelineRecorder,
      auditRecorder,
      unitOfWork,
      clock,
      generateAnalystDecisionId,
      generateEnforcementActionId,
      generateTimelineEventId,
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

  return { app, cases, decisions, enforcementActions, timelineRecorder, auditRecorder };
}

describe('enforcementRouter POST /cases/:caseId/decisions', () => {
  it('records FRAUD_CONFIRMED and returns decision + PENDING enforcement action', async () => {
    const { app, cases, decisions, enforcementActions, timelineRecorder, auditRecorder } = buildApp();
    await cases.save(
      Case.create({
        id: CASE_ID,
        organizationId: ORG_1,
        customerId: 'customer-1',
        riskScore: createRiskScore(80),
        priority: 'HIGH',
        now: NOW,
      }).transitionTo('IN_REVIEW', NOW),
    );

    const res = await request(app)
      .post(`/api/v1/cases/${CASE_ID}/decisions`)
      .send({
        decision: 'FRAUD_CONFIRMED',
        confidence: 95,
        comment: 'confirmed fraud',
        actionType: 'BLOCK',
        targetType: 'CUSTOMER',
        targetId: 'customer-1',
      })
      .expect(201);

    expect(res.body.decision.decision).toBe('FRAUD_CONFIRMED');
    expect(res.body.decision.confidence).toBe(95);
    expect(res.body.enforcementAction.status).toBe('PENDING');
    expect(res.body.enforcementAction.actionType).toBe('BLOCK');
    expect(res.body.caseStatus).toBe('IN_REVIEW');
    expect(decisions.all()).toHaveLength(1);
    expect(enforcementActions.all()).toHaveLength(1);
    expect(timelineRecorder.all()[0]?.eventType).toBe('DECISION_MADE');
    expect(auditRecorder.all()[0]?.action).toBe('RECORD_ANALYST_DECISION');
    expect(cases.all()[0]?.status).toBe('IN_REVIEW');
  });

  it('records FALSE_POSITIVE with null enforcementAction', async () => {
    const { app, cases, enforcementActions } = buildApp();
    await cases.save(
      Case.create({
        id: CASE_ID,
        organizationId: ORG_1,
        customerId: 'customer-1',
        riskScore: createRiskScore(20),
        priority: 'LOW',
        now: NOW,
      }),
    );

    const res = await request(app)
      .post(`/api/v1/cases/${CASE_ID}/decisions`)
      .send({
        decision: 'FALSE_POSITIVE',
        confidence: 30,
        comment: 'noise',
      })
      .expect(201);

    expect(res.body.decision.decision).toBe('FALSE_POSITIVE');
    expect(res.body.enforcementAction).toBeNull();
    expect(enforcementActions.all()).toHaveLength(0);
  });

  it('rejects AUDITOR with 403', async () => {
    const { app, cases } = buildApp(() => AUDITOR);
    await cases.save(
      Case.create({
        id: CASE_ID,
        organizationId: ORG_1,
        customerId: 'customer-1',
        riskScore: createRiskScore(50),
        priority: 'MEDIUM',
        now: NOW,
      }),
    );

    const res = await request(app)
      .post(`/api/v1/cases/${CASE_ID}/decisions`)
      .send({
        decision: 'INCONCLUSIVE',
        confidence: 10,
        comment: 'auditor blocked',
      })
      .expect(403);

    expect(res.body.error.code).toBe('FORBIDDEN_ROLE');
  });

  it('rejects invalid payload with 400', async () => {
    const { app, cases } = buildApp();
    await cases.save(
      Case.create({
        id: CASE_ID,
        organizationId: ORG_1,
        customerId: 'customer-1',
        riskScore: createRiskScore(50),
        priority: 'MEDIUM',
        now: NOW,
      }),
    );

    const res = await request(app)
      .post(`/api/v1/cases/${CASE_ID}/decisions`)
      .send({
        decision: 'NOT_A_DECISION',
        confidence: 10,
        comment: 'bad',
      })
      .expect(400);

    expect(res.body.error.code).toBe('INVARIANT_VIOLATION');
  });
});
