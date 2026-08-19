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
import { createApproveEnforcementActionUseCase } from '../../../../src/modules/case-management/application/ApproveEnforcementAction.js';
import { createRejectEnforcementActionUseCase } from '../../../../src/modules/case-management/application/RejectEnforcementAction.js';
import { createExecuteEnforcementActionUseCase } from '../../../../src/modules/case-management/application/ExecuteEnforcementAction.js';
import { createListEnforcementActionsUseCase } from '../../../../src/modules/case-management/application/ListEnforcementActions.js';
import { createRevertEnforcementActionUseCase } from '../../../../src/modules/case-management/application/RevertEnforcementAction.js';
import { InMemoryOutboxEventRepository } from '../../../helpers/case-management/InMemoryOutboxEventRepository.js';
import { generateOutboxEventId } from '../../../../src/shared/outbox/OutboxEventId.js';
import { InMemoryCaseRepository } from '../../../helpers/case-management/InMemoryCaseRepository.js';
import { InMemoryTimelineRecorder } from '../../../helpers/case-management/InMemoryTimelineRecorder.js';
import { InMemoryCaseManagementAuditRecorder } from '../../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';
import { InMemoryAnalystDecisionRepository } from '../../../helpers/case-management/InMemoryAnalystDecisionRepository.js';
import { InMemoryEnforcementActionRepository } from '../../../helpers/case-management/InMemoryEnforcementActionRepository.js';
import { InMemoryApprovalRequestRepository } from '../../../helpers/case-management/InMemoryApprovalRequestRepository.js';
import { InMemoryCustomerOutgoingEventRepository } from '../../../helpers/case-management/InMemoryCustomerOutgoingEventRepository.js';
import { InMemoryOrganizationFraudConfigRepository } from '../../../helpers/case-management/InMemoryOrganizationFraudConfigRepository.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/case-management/infrastructure/PassthroughUnitOfWork.js';
import { generateAnalystDecisionId } from '../../../../src/modules/case-management/domain/model/value-objects/AnalystDecisionId.js';
import { generateEnforcementActionId } from '../../../../src/modules/case-management/domain/model/value-objects/EnforcementActionId.js';
import { generateApprovalRequestId } from '../../../../src/modules/case-management/domain/model/value-objects/ApprovalRequestId.js';
import { generateCustomerOutgoingEventId } from '../../../../src/modules/case-management/domain/model/value-objects/CustomerOutgoingEventId.js';
import { generateTimelineEventId } from '../../../../src/modules/case-management/domain/model/value-objects/TimelineEventId.js';
import { EnforcementAction } from '../../../../src/modules/case-management/domain/model/aggregates/EnforcementAction.js';
import { Case } from '../../../../src/modules/case-management/domain/model/aggregates/Case.js';
import { OrganizationFraudConfig } from '../../../../src/modules/case-management/domain/model/aggregates/OrganizationFraudConfig.js';
import { createCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { createAnalystDecisionId } from '../../../../src/modules/case-management/domain/model/value-objects/AnalystDecisionId.js';
import { createEnforcementActionId } from '../../../../src/modules/case-management/domain/model/value-objects/EnforcementActionId.js';
import { createEnforcementActionType } from '../../../../src/modules/case-management/domain/model/value-objects/EnforcementActionType.js';
import { createRiskScore } from '../../../../src/modules/case-management/domain/model/value-objects/RiskScore.js';
import { createCasePriority } from '../../../../src/modules/case-management/domain/model/value-objects/CasePriority.js';
import { createOrganizationFraudConfigId } from '../../../../src/modules/case-management/domain/model/value-objects/OrganizationFraudConfigId.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_1 = oid('org-1');
const ACTION_ID = createEnforcementActionId(oid('action-http-execute-1'));
const CASE_ID = createCaseId(oid('case-http-execute-1'));
const CUSTOMER_ID = 'customer-1';
const WEBHOOK_URL = 'https://hooks.example/fraud';

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

function seedCase(cases: InMemoryCaseRepository): Case {
  const kase = Case.create({
    id: CASE_ID,
    organizationId: ORG_1,
    customerId: CUSTOMER_ID,
    riskScore: createRiskScore(80),
    priority: createCasePriority('HIGH'),
    now: NOW,
  });
  void cases.save(kase);
  return kase;
}

function seedApprovedAction(
  enforcementActions: InMemoryEnforcementActionRepository,
  actionType: 'BLOCK' | 'REVIEW' = 'BLOCK',
): EnforcementAction {
  let action = EnforcementAction.create({
    id: ACTION_ID,
    caseId: CASE_ID,
    organizationId: ORG_1,
    analystDecisionId: createAnalystDecisionId(oid('decision-http-execute-1')),
    actionType: createEnforcementActionType(actionType),
    targetType: 'CUSTOMER',
    targetId: CUSTOMER_ID,
    createdBy: oid('analyst-1'),
    now: NOW,
  });
  if (actionType !== 'REVIEW') {
    action = action.approve(NOW);
  }
  void enforcementActions.save(action);
  return action;
}

function buildApp(
  options: {
    actorPerRequest?: () => AuthContext;
    webhookUrl?: string | null;
    skipFraudConfig?: boolean;
  } = {},
) {
  const cases = new InMemoryCaseRepository();
  const decisions = new InMemoryAnalystDecisionRepository();
  const enforcementActions = new InMemoryEnforcementActionRepository();
  const approvalRequests = new InMemoryApprovalRequestRepository();
  const outgoingEvents = new InMemoryCustomerOutgoingEventRepository();
  const fraudConfig = new InMemoryOrganizationFraudConfigRepository();
  const timelineRecorder = new InMemoryTimelineRecorder();
  const auditRecorder = new InMemoryCaseManagementAuditRecorder();
  const outbox = new InMemoryOutboxEventRepository();
  const clock = new FixedClock(NOW);
  const unitOfWork = new PassthroughUnitOfWork();

  seedCase(cases);
  if (options.skipFraudConfig !== true) {
    fraudConfig.seed(
      OrganizationFraudConfig.create({
        id: createOrganizationFraudConfigId(oid('config-http-execute-1')),
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
        outboundWebhookUrl: options.webhookUrl === undefined ? WEBHOOK_URL : options.webhookUrl,
        now: NOW,
      }),
    );
  }

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
    approveEnforcementAction: createApproveEnforcementActionUseCase({
      enforcementActions,
      approvalRequests,
      auditRecorder,
      unitOfWork,
      clock,
      generateApprovalRequestId,
    }),
    rejectEnforcementAction: createRejectEnforcementActionUseCase({
      enforcementActions,
      approvalRequests,
      auditRecorder,
      unitOfWork,
      clock,
      generateApprovalRequestId,
    }),
    listEnforcementActions: createListEnforcementActionsUseCase({ enforcementActions }),
    executeEnforcementAction: createExecuteEnforcementActionUseCase({
      enforcementActions,
      outgoingEvents,
      cases,
      fraudConfig,
      auditRecorder,
      outbox,
      unitOfWork,
      clock,
      generateCustomerOutgoingEventId,
      generateOutboxEventId,
    }),
    revertEnforcementAction: createRevertEnforcementActionUseCase({
      enforcementActions,
      auditRecorder,
      outbox,
      unitOfWork,
      clock,
      generateOutboxEventId,
    }),
  });

  function testAuthMiddleware(req: Request, _res: Response, next: NextFunction): void {
    attachAuthContext(req, (options.actorPerRequest ?? (() => SUPERVISOR))());
    next();
  }

  const mounted = Router();
  mounted.use(testAuthMiddleware);
  mounted.use(router);

  const app = createApp({
    routers: [{ path: '/api/v1', router: mounted }],
    errorHandler: createErrorHandler(caseManagementErrorStatus),
  });

  return { app, enforcementActions, outgoingEvents, cases, auditRecorder, outbox };
}

describe('enforcementRouter POST /enforcement-actions/:id/execute', () => {
  it('executes APPROVED BLOCK and returns EXECUTED action + PENDING outbox', async () => {
    const { app, enforcementActions, outgoingEvents, cases, auditRecorder } = buildApp();
    seedApprovedAction(enforcementActions);
    const statusBefore = cases.all()[0]!.status;

    const res = await request(app)
      .post(`/api/v1/enforcement-actions/${ACTION_ID}/execute`)
      .send({})
      .expect(200);

    expect(res.body.enforcementAction.status).toBe('EXECUTED');
    expect(res.body.enforcementAction.actionType).toBe('BLOCK');
    expect(res.body.outgoingEvent.status).toBe('PENDING');
    expect(res.body.outgoingEvent.payload).toEqual({
      enforcement_action_id: ACTION_ID,
      case_id: CASE_ID,
      action_type: 'BLOCK',
      target_type: 'CUSTOMER',
      target_id: CUSTOMER_ID,
      organization_id: ORG_1,
    });
    expect(enforcementActions.all()[0]?.status).toBe('EXECUTED');
    expect(outgoingEvents.all()).toHaveLength(1);
    expect(cases.all()[0]?.status).toBe(statusBefore);
    expect(auditRecorder.all()[0]?.action).toBe('EXECUTE_ENFORCEMENT_ACTION');
  });

  it('auto-executes PENDING REVIEW without approval', async () => {
    const { app, enforcementActions } = buildApp();
    seedApprovedAction(enforcementActions, 'REVIEW');

    const res = await request(app)
      .post(`/api/v1/enforcement-actions/${ACTION_ID}/execute`)
      .send({})
      .expect(200);

    expect(res.body.enforcementAction.status).toBe('EXECUTED');
    expect(res.body.enforcementAction.actionType).toBe('REVIEW');
    expect(res.body.outgoingEvent.status).toBe('PENDING');
  });

  it('returns 400 fail-closed for BLOCK without webhook URL', async () => {
    const { app, enforcementActions, outgoingEvents } = buildApp({ webhookUrl: null });
    seedApprovedAction(enforcementActions);

    const res = await request(app)
      .post(`/api/v1/enforcement-actions/${ACTION_ID}/execute`)
      .send({})
      .expect(400);

    expect(res.body.error.code).toBe('INVARIANT_VIOLATION');
    expect(enforcementActions.all()[0]?.status).toBe('APPROVED');
    expect(outgoingEvents.all()).toHaveLength(0);
  });

  it('executes REVIEW without outbox when webhook URL is missing', async () => {
    const { app, enforcementActions, outgoingEvents } = buildApp({ webhookUrl: null });
    seedApprovedAction(enforcementActions, 'REVIEW');

    const res = await request(app)
      .post(`/api/v1/enforcement-actions/${ACTION_ID}/execute`)
      .send({})
      .expect(200);

    expect(res.body.enforcementAction.status).toBe('EXECUTED');
    expect(res.body.outgoingEvent).toBeNull();
    expect(outgoingEvents.all()).toHaveLength(0);
  });

  it('rejects ANALYST with 403', async () => {
    const { app, enforcementActions } = buildApp({ actorPerRequest: () => ANALYST });
    seedApprovedAction(enforcementActions);

    const res = await request(app)
      .post(`/api/v1/enforcement-actions/${ACTION_ID}/execute`)
      .send({})
      .expect(403);

    expect(res.body.error.code).toBe('FORBIDDEN_ROLE');
  });

  it('returns 404 when action is missing', async () => {
    const { app } = buildApp();

    const res = await request(app)
      .post(`/api/v1/enforcement-actions/${ACTION_ID}/execute`)
      .send({})
      .expect(404);

    expect(res.body.error.code).toBe('ENFORCEMENT_ACTION_NOT_FOUND');
  });
});

describe('enforcementRouter POST /enforcement-actions/:id/revert', () => {
  it('reverts an EXECUTED action and emits ENFORCEMENT_EXECUTED + ENFORCEMENT_REVERTED outbox events', async () => {
    const { app, enforcementActions, outbox } = buildApp();
    seedApprovedAction(enforcementActions);

    await request(app).post(`/api/v1/enforcement-actions/${ACTION_ID}/execute`).send({}).expect(200);
    expect(outbox.all().map((e) => e.eventType)).toEqual(['ENFORCEMENT_EXECUTED']);

    const res = await request(app).post(`/api/v1/enforcement-actions/${ACTION_ID}/revert`).send({}).expect(200);

    expect(res.body.status).toBe('REVERTED');
    expect(enforcementActions.all()[0]?.status).toBe('REVERTED');
    expect(outbox.all().map((e) => e.eventType)).toEqual(['ENFORCEMENT_EXECUTED', 'ENFORCEMENT_REVERTED']);
    const revertEvent = outbox.all()[1];
    expect(revertEvent?.aggregateType).toBe('enforcement_actions');
    expect(revertEvent?.payload).toMatchObject({ enforcement_action_id: ACTION_ID, status: 'REVERTED' });
  });

  it('returns 422 when reverting a non-EXECUTED (APPROVED) action', async () => {
    const { app, enforcementActions } = buildApp();
    seedApprovedAction(enforcementActions); // APPROVED, not executed

    const res = await request(app).post(`/api/v1/enforcement-actions/${ACTION_ID}/revert`).send({}).expect(422);
    expect(res.body.error.code).toBe('INVALID_TRANSITION');
  });

  it('returns 403 for ANALYST', async () => {
    const { app, enforcementActions } = buildApp({ actorPerRequest: () => ANALYST });
    seedApprovedAction(enforcementActions);

    const res = await request(app).post(`/api/v1/enforcement-actions/${ACTION_ID}/revert`).send({}).expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN_ROLE');
  });

  it('returns 404 when the action is missing', async () => {
    const { app } = buildApp();
    const res = await request(app).post(`/api/v1/enforcement-actions/${ACTION_ID}/revert`).send({}).expect(404);
    expect(res.body.error.code).toBe('ENFORCEMENT_ACTION_NOT_FOUND');
  });
});

describe('enforcementRouter GET /enforcement-actions', () => {
  it('lists tenant enforcement actions with a total for SUPERVISOR', async () => {
    const { app, enforcementActions } = buildApp();
    seedApprovedAction(enforcementActions);

    const res = await request(app).get('/api/v1/enforcement-actions').expect(200);

    expect(res.body.total).toBe(1);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({ actionType: 'BLOCK', targetType: 'CUSTOMER', status: 'APPROVED' });
  });

  it('filters by entity via targetType/targetId', async () => {
    const { app, enforcementActions } = buildApp();
    seedApprovedAction(enforcementActions);

    const match = await request(app)
      .get(`/api/v1/enforcement-actions?targetType=CUSTOMER&targetId=${CUSTOMER_ID}`)
      .expect(200);
    expect(match.body.total).toBe(1);

    const miss = await request(app).get('/api/v1/enforcement-actions?targetType=WALLET').expect(200);
    expect(miss.body.total).toBe(0);
  });

  it('returns 403 for ANALYST', async () => {
    const { app } = buildApp({ actorPerRequest: () => ANALYST });

    const res = await request(app).get('/api/v1/enforcement-actions').expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN_ROLE');
  });
});
