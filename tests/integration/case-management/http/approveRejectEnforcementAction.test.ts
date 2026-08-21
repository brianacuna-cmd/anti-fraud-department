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
import { createListCaseDecisionsUseCase } from '../../../../src/modules/case-management/application/ListCaseDecisions.js';
import { createRecordAnalystDecisionUseCase } from '../../../../src/modules/case-management/application/RecordAnalystDecision.js';
import { createApproveEnforcementActionUseCase } from '../../../../src/modules/case-management/application/ApproveEnforcementAction.js';
import { createRejectEnforcementActionUseCase } from '../../../../src/modules/case-management/application/RejectEnforcementAction.js';
import { createExecuteEnforcementActionUseCase } from '../../../../src/modules/case-management/application/ExecuteEnforcementAction.js';
import { createRevertEnforcementActionUseCase } from '../../../../src/modules/case-management/application/RevertEnforcementAction.js';
import { InMemoryOutboxEventRepository } from '../../../helpers/case-management/InMemoryOutboxEventRepository.js';
import { generateOutboxEventId } from '../../../../src/shared/outbox/OutboxEventId.js';
import { createListEnforcementActionsUseCase } from '../../../../src/modules/case-management/application/ListEnforcementActions.js';
import { InMemoryCaseRepository } from '../../../helpers/case-management/InMemoryCaseRepository.js';
import { InMemoryTimelineRecorder } from '../../../helpers/case-management/InMemoryTimelineRecorder.js';
import { InMemoryCaseManagementAuditRecorder } from '../../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';
import { InMemoryAnalystDecisionRepository } from '../../../helpers/case-management/InMemoryAnalystDecisionRepository.js';
import { InMemoryEnforcementActionRepository } from '../../../helpers/case-management/InMemoryEnforcementActionRepository.js';
import { InMemoryAssigneeDirectory } from '../../../helpers/case-management/InMemoryAssigneeDirectory.js';
import { InMemoryCaseManagementNotificationSender } from '../../../helpers/case-management/InMemoryCaseManagementNotificationSender.js';
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
import { createCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { createAnalystDecisionId } from '../../../../src/modules/case-management/domain/model/value-objects/AnalystDecisionId.js';
import { createEnforcementActionId } from '../../../../src/modules/case-management/domain/model/value-objects/EnforcementActionId.js';
import { createEnforcementActionType } from '../../../../src/modules/case-management/domain/model/value-objects/EnforcementActionType.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_1 = oid('org-1');
const ACTION_ID = createEnforcementActionId(oid('action-http-approve-1'));
const CASE_ID = createCaseId(oid('case-http-approve-1'));

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

function seedPendingAction(
  enforcementActions: InMemoryEnforcementActionRepository,
  actionType: 'BLOCK' | 'REVIEW' = 'BLOCK',
): EnforcementAction {
  const action = EnforcementAction.create({
    id: ACTION_ID,
    caseId: CASE_ID,
    organizationId: ORG_1,
    analystDecisionId: createAnalystDecisionId(oid('decision-http-1')),
    actionType: createEnforcementActionType(actionType),
    targetType: 'CUSTOMER',
    targetId: 'customer-1',
    createdBy: oid('analyst-1'),
    now: NOW,
  });
  void enforcementActions.save(action);
  return action;
}

function buildApp(actorPerRequest: () => AuthContext = () => SUPERVISOR) {
  const cases = new InMemoryCaseRepository();
  const decisions = new InMemoryAnalystDecisionRepository();
  const enforcementActions = new InMemoryEnforcementActionRepository();
  const approvalRequests = new InMemoryApprovalRequestRepository();
  const outgoingEvents = new InMemoryCustomerOutgoingEventRepository();
  const fraudConfig = new InMemoryOrganizationFraudConfigRepository();
  const timelineRecorder = new InMemoryTimelineRecorder();
  const auditRecorder = new InMemoryCaseManagementAuditRecorder();
  const clock = new FixedClock(NOW);
  const unitOfWork = new PassthroughUnitOfWork();

  const router = enforcementRouter({
    recordAnalystDecision: createRecordAnalystDecisionUseCase({
      cases,
      decisions,
      enforcementActions,
      approvalRequests,
      timelineRecorder,
      auditRecorder,
      notificationSender: new InMemoryCaseManagementNotificationSender(),
      assigneeDirectory: new InMemoryAssigneeDirectory(),
      unitOfWork,
      clock,
      generateAnalystDecisionId,
      generateEnforcementActionId,
      generateApprovalRequestId,
      generateTimelineEventId,
    }),
    listCaseDecisions: createListCaseDecisionsUseCase({ cases, analystDecisions: decisions }),
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
    revertEnforcementAction: createRevertEnforcementActionUseCase({
      enforcementActions,
      auditRecorder,
      outbox: new InMemoryOutboxEventRepository(),
      unitOfWork,
      clock,
      generateOutboxEventId,
    }),
    executeEnforcementAction: createExecuteEnforcementActionUseCase({
      outbox: new InMemoryOutboxEventRepository(),
      generateOutboxEventId,
      enforcementActions,
      outgoingEvents,
      cases,
      fraudConfig,
      auditRecorder,
      unitOfWork,
      clock,
      generateCustomerOutgoingEventId,
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

  return { app, enforcementActions, approvalRequests, auditRecorder };
}

describe('enforcementRouter POST /enforcement-actions/:id/approve', () => {
  it('approves PENDING BLOCK and returns APPROVED action + approval request', async () => {
    const { app, enforcementActions, approvalRequests, auditRecorder } = buildApp();
    seedPendingAction(enforcementActions);

    const res = await request(app)
      .post(`/api/v1/enforcement-actions/${ACTION_ID}/approve`)
      .send({ reviewerComment: 'approved' })
      .expect(200);

    expect(res.body.enforcementAction.status).toBe('APPROVED');
    expect(res.body.enforcementAction.actionType).toBe('BLOCK');
    expect(res.body.approvalRequest.status).toBe('APPROVED');
    expect(res.body.approvalRequest.reviewerComment).toBe('approved');
    expect(enforcementActions.all()[0]?.status).toBe('APPROVED');
    expect(approvalRequests.all()[0]?.status).toBe('APPROVED');
    expect(auditRecorder.all()[0]?.action).toBe('APPROVE_ENFORCEMENT_ACTION');
  });

  it('rejects ANALYST with 403', async () => {
    const { app, enforcementActions } = buildApp(() => ANALYST);
    seedPendingAction(enforcementActions);

    const res = await request(app)
      .post(`/api/v1/enforcement-actions/${ACTION_ID}/approve`)
      .send({})
      .expect(403);

    expect(res.body.error.code).toBe('FORBIDDEN_ROLE');
  });

  it('rejects REVIEW with 400', async () => {
    const { app, enforcementActions } = buildApp();
    seedPendingAction(enforcementActions, 'REVIEW');

    const res = await request(app)
      .post(`/api/v1/enforcement-actions/${ACTION_ID}/approve`)
      .send({})
      .expect(400);

    expect(res.body.error.code).toBe('INVARIANT_VIOLATION');
  });
});

describe('enforcementRouter POST /enforcement-actions/:id/reject', () => {
  it('rejects PENDING action and returns REJECTED status without execute', async () => {
    const { app, enforcementActions, approvalRequests, auditRecorder } = buildApp();
    seedPendingAction(enforcementActions);

    const res = await request(app)
      .post(`/api/v1/enforcement-actions/${ACTION_ID}/reject`)
      .send({ reviewerComment: 'nope' })
      .expect(200);

    expect(res.body.enforcementAction.status).toBe('REJECTED');
    expect(res.body.approvalRequest.status).toBe('REJECTED');
    expect(res.body.approvalRequest.reviewerComment).toBe('nope');
    expect(enforcementActions.all()[0]?.status).toBe('REJECTED');
    expect(approvalRequests.all()[0]?.status).toBe('REJECTED');
    expect(auditRecorder.all()[0]?.action).toBe('REJECT_ENFORCEMENT_ACTION');
  });

  it('returns 404 when action is missing', async () => {
    const { app } = buildApp();

    const res = await request(app)
      .post(`/api/v1/enforcement-actions/${ACTION_ID}/reject`)
      .send({})
      .expect(404);

    expect(res.body.error.code).toBe('ENFORCEMENT_ACTION_NOT_FOUND');
  });
});
