import { oid } from '../../../support/oid.js';
import { createRejectEnforcementActionUseCase } from '../../../../src/modules/case-management/application/RejectEnforcementAction.js';
import { EnforcementAction } from '../../../../src/modules/case-management/domain/model/aggregates/EnforcementAction.js';
import { ApprovalRequest } from '../../../../src/modules/case-management/domain/model/aggregates/ApprovalRequest.js';
import { createCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { createAnalystDecisionId } from '../../../../src/modules/case-management/domain/model/value-objects/AnalystDecisionId.js';
import { createEnforcementActionId } from '../../../../src/modules/case-management/domain/model/value-objects/EnforcementActionId.js';
import {
  createApprovalRequestId,
  generateApprovalRequestId,
} from '../../../../src/modules/case-management/domain/model/value-objects/ApprovalRequestId.js';
import { createEnforcementActionType } from '../../../../src/modules/case-management/domain/model/value-objects/EnforcementActionType.js';
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
const ACTION_ID = createEnforcementActionId(oid('action-reject-1'));
const CASE_ID = createCaseId(oid('case-reject-1'));

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

function buildPendingAction(
  overrides: Partial<Parameters<typeof EnforcementAction.create>[0]> = {},
): EnforcementAction {
  return EnforcementAction.create({
    id: ACTION_ID,
    caseId: CASE_ID,
    organizationId: ORG_1,
    analystDecisionId: createAnalystDecisionId(oid('decision-reject-1')),
    actionType: createEnforcementActionType('SUSPEND'),
    targetType: 'CUSTOMER',
    targetId: 'customer-1',
    createdBy: oid('analyst-1'),
    now: NOW,
    ...overrides,
  });
}

function buildUseCase(seed?: EnforcementAction, seedApproval?: ApprovalRequest) {
  const enforcementActions = new InMemoryEnforcementActionRepository();
  const approvalRequests = new InMemoryApprovalRequestRepository();
  const auditRecorder = new InMemoryCaseManagementAuditRecorder();
  if (seed !== undefined) {
    void enforcementActions.save(seed);
  }
  if (seedApproval !== undefined) {
    void approvalRequests.save(seedApproval);
  }
  const rejectEnforcementAction = createRejectEnforcementActionUseCase({
    enforcementActions,
    approvalRequests,
    auditRecorder,
    unitOfWork: new PassthroughUnitOfWork(),
    clock: new FixedClock(NOW),
    generateApprovalRequestId,
  });
  return { rejectEnforcementAction, enforcementActions, approvalRequests, auditRecorder };
}

describe('createRejectEnforcementActionUseCase', () => {
  it('rejects PENDING non-REVIEW action to REJECTED and approval_request PENDING→REJECTED without executing', async () => {
    const action = buildPendingAction({ actionType: 'DELETE' });
    const existingApproval = ApprovalRequest.create({
      id: createApprovalRequestId(oid('approval-reject-1')),
      enforcementActionId: action.id,
      requesterId: action.createdBy,
      now: NOW,
    });
    const { rejectEnforcementAction, enforcementActions, approvalRequests, auditRecorder } =
      buildUseCase(action, existingApproval);

    const result = await rejectEnforcementAction({
      auth: SUPERVISOR,
      enforcementActionId: ACTION_ID,
      reviewerComment: 'insufficient evidence',
    });

    expect(result.enforcementAction.status).toBe('REJECTED');
    expect(result.enforcementAction.actionType).toBe('DELETE');
    expect(result.approvalRequest.status).toBe('REJECTED');
    expect(result.approvalRequest.reviewerId).toBe(oid('supervisor-1'));
    expect(result.approvalRequest.reviewerComment).toBe('insufficient evidence');
    expect(enforcementActions.all()[0]?.status).toBe('REJECTED');
    expect(approvalRequests.all()[0]?.status).toBe('REJECTED');
    expect(auditRecorder.all()[0]?.action).toBe('REJECT_ENFORCEMENT_ACTION');
    expect(auditRecorder.all()[0]?.detail).toMatchObject({
      enforcementActionId: ACTION_ID,
      actionType: 'DELETE',
    });
  });

  it('creates a PENDING approval_request when missing, then rejects it with the action', async () => {
    const { rejectEnforcementAction, approvalRequests } = buildUseCase(buildPendingAction());

    const result = await rejectEnforcementAction({
      auth: SUPERVISOR,
      enforcementActionId: ACTION_ID,
      reviewerComment: null,
    });

    expect(result.enforcementAction.status).toBe('REJECTED');
    expect(result.approvalRequest.status).toBe('REJECTED');
    expect(result.approvalRequest.requesterId).toBe(oid('analyst-1'));
    expect(approvalRequests.all()).toHaveLength(1);
  });

  it('rejects REVIEW actions because they skip the approval gate', async () => {
    const { rejectEnforcementAction, approvalRequests } = buildUseCase(
      buildPendingAction({ actionType: 'REVIEW' }),
    );

    await expect(
      rejectEnforcementAction({
        auth: SUPERVISOR,
        enforcementActionId: ACTION_ID,
        reviewerComment: 'n/a',
      }),
    ).rejects.toMatchObject({
      code: 'INVARIANT_VIOLATION',
    } satisfies Partial<CaseManagementError>);

    expect(approvalRequests.all()).toHaveLength(0);
  });

  it('rejects ANALYST with FORBIDDEN_ROLE', async () => {
    const { rejectEnforcementAction, auditRecorder } = buildUseCase(buildPendingAction());

    await expect(
      rejectEnforcementAction({
        auth: ANALYST,
        enforcementActionId: ACTION_ID,
        reviewerComment: null,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_ROLE' } satisfies Partial<CaseManagementError>);

    expect(auditRecorder.all()).toHaveLength(0);
  });

  it('returns ENFORCEMENT_ACTION_NOT_FOUND when action is missing', async () => {
    const { rejectEnforcementAction } = buildUseCase();

    await expect(
      rejectEnforcementAction({
        auth: SUPERVISOR,
        enforcementActionId: ACTION_ID,
        reviewerComment: null,
      }),
    ).rejects.toMatchObject({
      code: 'ENFORCEMENT_ACTION_NOT_FOUND',
    } satisfies Partial<CaseManagementError>);
  });

  it('does not leave action executable after reject (status stays REJECTED)', async () => {
    const { rejectEnforcementAction, enforcementActions } = buildUseCase(buildPendingAction());

    await rejectEnforcementAction({
      auth: SUPERVISOR,
      enforcementActionId: ACTION_ID,
      reviewerComment: 'no',
    });

    const stored = enforcementActions.all()[0]!;
    expect(stored.status).toBe('REJECTED');
    expect(() => stored.execute(NOW)).toThrow('cannot transition');
  });
});
