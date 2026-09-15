import { oid } from '../../../support/oid.js';
import { createApproveEnforcementActionUseCase } from '../../../../src/modules/case-management/application/ApproveEnforcementAction.js';
import { EnforcementAction } from '../../../../src/modules/case-management/domain/model/aggregates/EnforcementAction.js';
import { ApprovalRequest } from '../../../../src/modules/case-management/domain/model/aggregates/ApprovalRequest.js';
import { createCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { createAnalystDecisionId } from '../../../../src/modules/case-management/domain/model/value-objects/AnalystDecisionId.js';
import {
  createEnforcementActionId,
  generateEnforcementActionId,
} from '../../../../src/modules/case-management/domain/model/value-objects/EnforcementActionId.js';
import {
  createApprovalRequestId,
  generateApprovalRequestId,
} from '../../../../src/modules/case-management/domain/model/value-objects/ApprovalRequestId.js';
import { createEnforcementActionType } from '../../../../src/modules/case-management/domain/model/value-objects/EnforcementActionType.js';
import { Case } from '../../../../src/modules/case-management/domain/model/aggregates/Case.js';
import { OrganizationFraudConfig } from '../../../../src/modules/case-management/domain/model/aggregates/OrganizationFraudConfig.js';
import { createRiskScore } from '../../../../src/modules/case-management/domain/model/value-objects/RiskScore.js';
import { createCasePriority } from '../../../../src/modules/case-management/domain/model/value-objects/CasePriority.js';
import { createOrganizationFraudConfigId } from '../../../../src/modules/case-management/domain/model/value-objects/OrganizationFraudConfigId.js';
import { generateCustomerOutgoingEventId } from '../../../../src/modules/case-management/domain/model/value-objects/CustomerOutgoingEventId.js';
import { generateOutboxEventId } from '../../../../src/shared/outbox/OutboxEventId.js';
import { InMemoryOutboxEventRepository } from '../../../helpers/case-management/InMemoryOutboxEventRepository.js';
import { InMemoryCustomerOutgoingEventRepository } from '../../../helpers/case-management/InMemoryCustomerOutgoingEventRepository.js';
import { InMemoryCaseRepository } from '../../../helpers/case-management/InMemoryCaseRepository.js';
import { InMemoryOrganizationFraudConfigRepository } from '../../../helpers/case-management/InMemoryOrganizationFraudConfigRepository.js';
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
const ACTION_ID = createEnforcementActionId(oid('action-approve-1'));
const CASE_ID = createCaseId(oid('case-approve-1'));

const SUPERVISOR = createAuthContext({
  userId: oid('supervisor-1'),
  organizationId: ORG_1,
  actorType: 'USER',
  roleId: 'SUPERVISOR',
});
const ADMIN = createAuthContext({
  userId: oid('admin-1'),
  organizationId: ORG_1,
  actorType: 'USER',
  roleId: 'ADMIN',
});
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

function buildPendingAction(
  overrides: Partial<Parameters<typeof EnforcementAction.create>[0]> = {},
): EnforcementAction {
  return EnforcementAction.create({
    id: ACTION_ID,
    caseId: CASE_ID,
    organizationId: ORG_1,
    analystDecisionId: createAnalystDecisionId(oid('decision-approve-1')),
    actionType: createEnforcementActionType('BLOCK'),
    targetType: 'CUSTOMER',
    targetId: 'customer-1',
    createdBy: oid('analyst-1'),
    now: NOW,
    ...overrides,
  });
}

function buildUseCase(seed?: EnforcementAction, seedApproval?: ApprovalRequest, webhookUrl: string | null = null) {
  const enforcementActions = new InMemoryEnforcementActionRepository();
  const cases = new InMemoryCaseRepository();
  const fraudConfig = new InMemoryOrganizationFraudConfigRepository();
  const outgoingEvents = new InMemoryCustomerOutgoingEventRepository();
  const outbox = new InMemoryOutboxEventRepository();
  void cases.save(
    Case.create({
      id: CASE_ID,
      organizationId: ORG_1,
      customerId: 'customer-1',
      riskScore: createRiskScore(80),
      priority: createCasePriority('HIGH'),
      now: NOW,
    }),
  );
  if (webhookUrl !== null) {
    fraudConfig.seed(
      OrganizationFraudConfig.create({
        id: createOrganizationFraudConfigId(oid('config-approve-1')),
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
        outboundWebhookUrl: webhookUrl,
        now: NOW,
      }),
    );
  }
  const approvalRequests = new InMemoryApprovalRequestRepository();
  const auditRecorder = new InMemoryCaseManagementAuditRecorder();
  if (seed !== undefined) {
    void enforcementActions.save(seed);
  }
  if (seedApproval !== undefined) {
    void approvalRequests.save(seedApproval);
  }
  const approveEnforcementAction = createApproveEnforcementActionUseCase({
    enforcementActions,
    approvalRequests,
    outgoingEvents,
    cases,
    fraudConfig,
    auditRecorder,
    outbox,
    unitOfWork: new PassthroughUnitOfWork(),
    clock: new FixedClock(NOW),
    generateApprovalRequestId,
    generateCustomerOutgoingEventId,
    generateOutboxEventId,
  });
  return { approveEnforcementAction, enforcementActions, approvalRequests, auditRecorder, outgoingEvents, outbox };
}

describe('createApproveEnforcementActionUseCase', () => {
  it('executes the measure it approves when the tenant can deliver it', async () => {
    const { approveEnforcementAction, enforcementActions, approvalRequests, auditRecorder, outgoingEvents, outbox } =
      buildUseCase(buildPendingAction({ actionType: 'BLOCK' }), undefined, 'https://hooks.example/fraud');

    const result = await approveEnforcementAction({
      auth: SUPERVISOR,
      enforcementActionId: ACTION_ID,
      reviewerComment: 'confirmed',
    });

    expect(result.executed).toBe(true);
    expect(result.enforcementAction.status).toBe('EXECUTED');
    expect(result.outgoingEvent).not.toBeNull();
    expect(enforcementActions.all()[0]?.status).toBe('EXECUTED');
    expect(approvalRequests.all()[0]?.status).toBe('APPROVED');
    expect(outgoingEvents.all()).toHaveLength(1);
    expect(outbox.all().map((e) => e.eventType)).toEqual(['ENFORCEMENT_EXECUTED']);
    expect(auditRecorder.all().map((e) => e.action)).toEqual([
      'APPROVE_ENFORCEMENT_ACTION',
      'EXECUTE_ENFORCEMENT_ACTION',
    ]);
  });

  it('leaves a webhook-bound measure APPROVED when no outbound webhook is configured', async () => {
    const { approveEnforcementAction, auditRecorder } = buildUseCase(buildPendingAction({ actionType: 'SUSPEND' }));

    const result = await approveEnforcementAction({
      auth: SUPERVISOR,
      enforcementActionId: ACTION_ID,
      reviewerComment: null,
    });

    expect(result.executed).toBe(false);
    expect(result.enforcementAction.status).toBe('APPROVED');
    expect(auditRecorder.all().map((e) => e.action)).toEqual(['APPROVE_ENFORCEMENT_ACTION']);
  });

  it('approves PENDING non-REVIEW action to APPROVED and transitions approval_request PENDING→APPROVED', async () => {
    const action = buildPendingAction({ actionType: 'RESTRICT' });
    const existingApproval = ApprovalRequest.create({
      id: createApprovalRequestId(oid('approval-existing-1')),
      enforcementActionId: action.id,
      requesterId: action.createdBy,
      now: NOW,
    });
    const { approveEnforcementAction, enforcementActions, approvalRequests, auditRecorder } =
      buildUseCase(action, existingApproval);

    const result = await approveEnforcementAction({
      auth: SUPERVISOR,
      enforcementActionId: ACTION_ID,
      reviewerComment: 'looks good',
    });

    expect(result.enforcementAction.status).toBe('APPROVED');
    expect(result.enforcementAction.actionType).toBe('RESTRICT');
    expect(result.approvalRequest.status).toBe('APPROVED');
    expect(result.approvalRequest.reviewerId).toBe(oid('supervisor-1'));
    expect(result.approvalRequest.reviewerComment).toBe('looks good');
    expect(result.approvalRequest.reviewedAt).toBe(NOW);
    expect(enforcementActions.all()[0]?.status).toBe('APPROVED');
    expect(approvalRequests.all()[0]?.status).toBe('APPROVED');
    expect(auditRecorder.all()).toHaveLength(1);
    expect(auditRecorder.all()[0]?.action).toBe('APPROVE_ENFORCEMENT_ACTION');
    expect(auditRecorder.all()[0]?.detail).toMatchObject({
      enforcementActionId: ACTION_ID,
      actionType: 'RESTRICT',
      approvalRequestId: existingApproval.id,
    });
  });

  it('creates a PENDING approval_request when missing, then approves it with the action', async () => {
    const { approveEnforcementAction, approvalRequests } = buildUseCase(buildPendingAction());

    const result = await approveEnforcementAction({
      auth: SUPERVISOR,
      enforcementActionId: ACTION_ID,
      reviewerComment: null,
    });

    expect(result.enforcementAction.status).toBe('APPROVED');
    expect(result.approvalRequest.status).toBe('APPROVED');
    expect(result.approvalRequest.requesterId).toBe(oid('analyst-1'));
    expect(result.approvalRequest.reviewerId).toBe(oid('supervisor-1'));
    expect(approvalRequests.all()).toHaveLength(1);
  });

  it('rejects REVIEW actions because they skip the approval gate', async () => {
    const reviewAction = buildPendingAction({
      id: generateEnforcementActionId(),
      actionType: 'REVIEW',
    });
    const { approveEnforcementAction, approvalRequests, auditRecorder } = buildUseCase(reviewAction);

    await expect(
      approveEnforcementAction({
        auth: SUPERVISOR,
        enforcementActionId: reviewAction.id,
        reviewerComment: null,
      }),
    ).rejects.toMatchObject({
      code: 'INVARIANT_VIOLATION',
    } satisfies Partial<CaseManagementError>);

    expect(approvalRequests.all()).toHaveLength(0);
    expect(auditRecorder.all()).toHaveLength(0);
  });

  /**
   * ADMIN esta aqui a proposito: autorizar una sancion es un acto operativo,
   * y quien administra los permisos del equipo no lo ejerce (SoD, ver
   * `shared/kernel/AccessTier.ts`).
   */
  it.each([
    ['ANALYST', () => ANALYST],
    ['AUDITOR', () => AUDITOR],
    ['ADMIN', () => ADMIN],
  ])('rejects %s with FORBIDDEN_ROLE', async (_role, actor) => {
    const { approveEnforcementAction } = buildUseCase(buildPendingAction());

    await expect(
      approveEnforcementAction({
        auth: actor(),
        enforcementActionId: ACTION_ID,
        reviewerComment: null,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_ROLE' } satisfies Partial<CaseManagementError>);
  });

  it('rejects cross-tenant access', async () => {
    const { approveEnforcementAction } = buildUseCase(
      buildPendingAction({ organizationId: ORG_2 }),
    );

    await expect(
      approveEnforcementAction({
        auth: SUPERVISOR,
        enforcementActionId: ACTION_ID,
        reviewerComment: null,
      }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN_CROSS_TENANT',
    } satisfies Partial<CaseManagementError>);
  });

  it('returns ENFORCEMENT_ACTION_NOT_FOUND when action is missing', async () => {
    const { approveEnforcementAction } = buildUseCase();

    await expect(
      approveEnforcementAction({
        auth: SUPERVISOR,
        enforcementActionId: ACTION_ID,
        reviewerComment: null,
      }),
    ).rejects.toMatchObject({
      code: 'ENFORCEMENT_ACTION_NOT_FOUND',
    } satisfies Partial<CaseManagementError>);
  });

  it('rejects approve when action is already REJECTED', async () => {
    const rejected = buildPendingAction().reject(NOW);
    const { approveEnforcementAction } = buildUseCase(rejected);

    await expect(
      approveEnforcementAction({
        auth: SUPERVISOR,
        enforcementActionId: ACTION_ID,
        reviewerComment: null,
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
    } satisfies Partial<CaseManagementError>);
  });
});
