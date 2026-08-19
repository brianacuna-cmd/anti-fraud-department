import { oid } from '../../../support/oid.js';
import { createReviewApprovalRequestUseCase } from '../../../../src/modules/case-management/application/ReviewApprovalRequest.js';
import { EnforcementAction } from '../../../../src/modules/case-management/domain/model/aggregates/EnforcementAction.js';
import { ApprovalRequest } from '../../../../src/modules/case-management/domain/model/aggregates/ApprovalRequest.js';
import { createEnforcementActionId } from '../../../../src/modules/case-management/domain/model/value-objects/EnforcementActionId.js';
import { createApprovalRequestId } from '../../../../src/modules/case-management/domain/model/value-objects/ApprovalRequestId.js';
import { createAnalystDecisionId } from '../../../../src/modules/case-management/domain/model/value-objects/AnalystDecisionId.js';
import { createCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { InMemoryEnforcementActionRepository } from '../../../helpers/case-management/InMemoryEnforcementActionRepository.js';
import { InMemoryApprovalRequestRepository } from '../../../helpers/case-management/InMemoryApprovalRequestRepository.js';
import { InMemoryCaseManagementAuditRecorder } from '../../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/case-management/infrastructure/PassthroughUnitOfWork.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { CaseManagementError } from '../../../../src/modules/case-management/domain/errors/CaseManagementError.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_1 = oid('org-1');
const ORG_2 = oid('org-2');
const ACTION_ID = oid('ea-1');
const REQ_ID = oid('ar-1');
const CASE_ID = oid('case-1');

const SUPERVISOR = createAuthContext({ userId: oid('sup-1'), organizationId: ORG_1, actorType: 'USER', roleId: 'SUPERVISOR' });
const ANALYST = createAuthContext({ userId: oid('an-1'), organizationId: ORG_1, actorType: 'USER', roleId: 'ANALYST' });

function buildAction(organizationId = ORG_1): EnforcementAction {
  return EnforcementAction.create({
    id: createEnforcementActionId(ACTION_ID),
    caseId: createCaseId(CASE_ID),
    organizationId,
    analystDecisionId: createAnalystDecisionId(oid('ad-1')),
    actionType: 'BLOCK',
    targetType: 'CUSTOMER',
    targetId: 'customer-1',
    createdBy: oid('an-1'),
    now: NOW,
  });
}

function buildRequest(): ApprovalRequest {
  return ApprovalRequest.create({
    id: createApprovalRequestId(REQ_ID),
    enforcementActionId: createEnforcementActionId(ACTION_ID),
    requesterId: oid('an-1'),
    now: NOW,
  });
}

function build(action: EnforcementAction | null = buildAction(), request: ApprovalRequest | null = buildRequest()) {
  const enforcementActions = new InMemoryEnforcementActionRepository();
  if (action) void enforcementActions.save(action);
  const approvalRequests = new InMemoryApprovalRequestRepository();
  if (request) void approvalRequests.save(request);
  const auditRecorder = new InMemoryCaseManagementAuditRecorder();
  const reviewApprovalRequest = createReviewApprovalRequestUseCase({
    approvalRequests,
    enforcementActions,
    auditRecorder,
    unitOfWork: new PassthroughUnitOfWork(),
    clock: new FixedClock(NOW),
  });
  return { reviewApprovalRequest, enforcementActions, approvalRequests, auditRecorder };
}

describe('createReviewApprovalRequestUseCase', () => {
  it('APPROVED cascades to the enforcement action and records the comment + audit', async () => {
    const h = build();

    const result = await h.reviewApprovalRequest({
      auth: SUPERVISOR,
      approvalRequestId: REQ_ID,
      decision: 'APPROVED',
      comment: 'verified, proceed',
    });

    expect(result.approvalRequest.status).toBe('APPROVED');
    expect(result.approvalRequest.reviewerComment).toBe('verified, proceed');
    expect(result.approvalRequest.reviewerId).toBe(oid('sup-1'));
    expect(result.enforcementAction.status).toBe('APPROVED');
    expect(h.enforcementActions.all()[0]?.status).toBe('APPROVED');
    expect(h.auditRecorder.all()[0]?.action).toBe('REVIEW_APPROVAL_REQUEST');
    expect(h.auditRecorder.all()[0]?.detail).toMatchObject({ decision: 'APPROVED', comment: 'verified, proceed' });
  });

  it('REJECTED cascades a rejection to the enforcement action', async () => {
    const h = build();
    const result = await h.reviewApprovalRequest({
      auth: SUPERVISOR,
      approvalRequestId: REQ_ID,
      decision: 'REJECTED',
      comment: 'insufficient evidence',
    });
    expect(result.approvalRequest.status).toBe('REJECTED');
    expect(result.enforcementAction.status).toBe('REJECTED');
  });

  it('rejects an empty comment with INVARIANT_VIOLATION', async () => {
    const h = build();
    await expect(
      h.reviewApprovalRequest({ auth: SUPERVISOR, approvalRequestId: REQ_ID, decision: 'APPROVED', comment: '   ' }),
    ).rejects.toMatchObject({ code: 'INVARIANT_VIOLATION' } satisfies Partial<CaseManagementError>);
  });

  it('rejects ANALYST with FORBIDDEN_ROLE', async () => {
    const h = build();
    await expect(
      h.reviewApprovalRequest({ auth: ANALYST, approvalRequestId: REQ_ID, decision: 'APPROVED', comment: 'x' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_ROLE' });
  });

  it('throws APPROVAL_REQUEST_NOT_FOUND when the request is missing', async () => {
    const h = build(buildAction(), null);
    await expect(
      h.reviewApprovalRequest({ auth: SUPERVISOR, approvalRequestId: REQ_ID, decision: 'APPROVED', comment: 'x' }),
    ).rejects.toMatchObject({ code: 'APPROVAL_REQUEST_NOT_FOUND' });
  });

  it('rejects cross-tenant (via the linked enforcement action) with FORBIDDEN_CROSS_TENANT', async () => {
    const h = build(buildAction(ORG_2));
    await expect(
      h.reviewApprovalRequest({ auth: SUPERVISOR, approvalRequestId: REQ_ID, decision: 'APPROVED', comment: 'x' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_CROSS_TENANT' });
  });

  it('rejects re-reviewing an already-decided request with INVALID_TRANSITION', async () => {
    const h = build();
    await h.reviewApprovalRequest({ auth: SUPERVISOR, approvalRequestId: REQ_ID, decision: 'APPROVED', comment: 'first' });
    await expect(
      h.reviewApprovalRequest({ auth: SUPERVISOR, approvalRequestId: REQ_ID, decision: 'REJECTED', comment: 'again' }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });
});
