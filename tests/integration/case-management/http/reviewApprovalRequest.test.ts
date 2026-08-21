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
import { approvalRequestRouter } from '../../../../src/modules/case-management/infrastructure/adapters/inbound/http/approvalRequestRouter.js';
import { createReviewApprovalRequestUseCase } from '../../../../src/modules/case-management/application/ReviewApprovalRequest.js';
import { createListApprovalRequestsUseCase } from '../../../../src/modules/case-management/application/ListApprovalRequests.js';
import { InMemoryEnforcementActionRepository } from '../../../helpers/case-management/InMemoryEnforcementActionRepository.js';
import { InMemoryApprovalRequestRepository } from '../../../helpers/case-management/InMemoryApprovalRequestRepository.js';
import { InMemoryCaseManagementAuditRecorder } from '../../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/case-management/infrastructure/PassthroughUnitOfWork.js';
import { EnforcementAction } from '../../../../src/modules/case-management/domain/model/aggregates/EnforcementAction.js';
import { ApprovalRequest } from '../../../../src/modules/case-management/domain/model/aggregates/ApprovalRequest.js';
import { createEnforcementActionId } from '../../../../src/modules/case-management/domain/model/value-objects/EnforcementActionId.js';
import { createApprovalRequestId } from '../../../../src/modules/case-management/domain/model/value-objects/ApprovalRequestId.js';
import { createAnalystDecisionId } from '../../../../src/modules/case-management/domain/model/value-objects/AnalystDecisionId.js';
import { createCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_1 = oid('org-1');
const ACTION_ID = oid('ea-1');
const REQ_ID = oid('ar-1');

const SUPERVISOR = createAuthContext({ userId: oid('sup-1'), organizationId: ORG_1, actorType: 'USER', roleId: 'SUPERVISOR' });
const ANALYST = createAuthContext({ userId: oid('an-1'), organizationId: ORG_1, actorType: 'USER', roleId: 'ANALYST' });

function seedAction(enforcementActions: InMemoryEnforcementActionRepository): void {
  void enforcementActions.save(
    EnforcementAction.create({
      id: createEnforcementActionId(ACTION_ID),
      caseId: createCaseId(oid('case-1')),
      organizationId: ORG_1,
      analystDecisionId: createAnalystDecisionId(oid('ad-1')),
      actionType: 'BLOCK',
      targetType: 'CUSTOMER',
      targetId: 'customer-1',
      createdBy: oid('an-1'),
      now: NOW,
    }),
  );
}

function seedRequest(approvalRequests: InMemoryApprovalRequestRepository): void {
  void approvalRequests.save(
    ApprovalRequest.create({
      id: createApprovalRequestId(REQ_ID),
      enforcementActionId: createEnforcementActionId(ACTION_ID),
      requesterId: oid('an-1'),
      now: NOW,
    }),
  );
}

function buildApp(actorPerRequest: () => AuthContext = () => SUPERVISOR) {
  const enforcementActions = new InMemoryEnforcementActionRepository();
  const approvalRequests = new InMemoryApprovalRequestRepository();
  const router = approvalRequestRouter({
    reviewApprovalRequest: createReviewApprovalRequestUseCase({
      approvalRequests,
      enforcementActions,
      auditRecorder: new InMemoryCaseManagementAuditRecorder(),
      unitOfWork: new PassthroughUnitOfWork(),
      clock: new FixedClock(NOW),
    }),
    listApprovalRequests: createListApprovalRequestsUseCase({
      enforcementActions,
      approvalRequests,
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
  return { app, enforcementActions, approvalRequests };
}

describe('approvalRequestRouter PATCH /approval-requests/:id/review', () => {
  it('APPROVED reviews the request and cascades to the enforcement action', async () => {
    const { app, enforcementActions, approvalRequests } = buildApp();
    seedAction(enforcementActions);
    seedRequest(approvalRequests);

    const res = await request(app)
      .patch(`/api/v1/approval-requests/${REQ_ID}/review`)
      .send({ decision: 'APPROVED', comment: 'verified' })
      .expect(200);

    expect(res.body.approvalRequest.status).toBe('APPROVED');
    expect(res.body.approvalRequest.reviewerComment).toBe('verified');
    expect(res.body.enforcementAction.status).toBe('APPROVED');
  });

  it('returns 400 when the comment is missing', async () => {
    const { app, enforcementActions, approvalRequests } = buildApp();
    seedAction(enforcementActions);
    seedRequest(approvalRequests);

    const res = await request(app)
      .patch(`/api/v1/approval-requests/${REQ_ID}/review`)
      .send({ decision: 'REJECTED' })
      .expect(400);
    expect(res.body.error.code).toBe('INVARIANT_VIOLATION');
  });

  it('returns 403 for ANALYST', async () => {
    const { app, enforcementActions, approvalRequests } = buildApp(() => ANALYST);
    seedAction(enforcementActions);
    seedRequest(approvalRequests);

    const res = await request(app)
      .patch(`/api/v1/approval-requests/${REQ_ID}/review`)
      .send({ decision: 'APPROVED', comment: 'x' })
      .expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN_ROLE');
  });

  it('returns 404 when the approval request is missing', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .patch(`/api/v1/approval-requests/${REQ_ID}/review`)
      .send({ decision: 'APPROVED', comment: 'x' })
      .expect(404);
    expect(res.body.error.code).toBe('APPROVAL_REQUEST_NOT_FOUND');
  });
});
