import { oid } from '../../../support/oid.js';
import { createRecordAnalystDecisionUseCase } from '../../../../src/modules/case-management/application/RecordAnalystDecision.js';
import { Case } from '../../../../src/modules/case-management/domain/model/aggregates/Case.js';
import { EnforcementAction } from '../../../../src/modules/case-management/domain/model/aggregates/EnforcementAction.js';
import { createCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { createRiskScore } from '../../../../src/modules/case-management/domain/model/value-objects/RiskScore.js';
import { generateAnalystDecisionId } from '../../../../src/modules/case-management/domain/model/value-objects/AnalystDecisionId.js';
import { generateEnforcementActionId } from '../../../../src/modules/case-management/domain/model/value-objects/EnforcementActionId.js';
import { generateApprovalRequestId } from '../../../../src/modules/case-management/domain/model/value-objects/ApprovalRequestId.js';
import { generateTimelineEventId } from '../../../../src/modules/case-management/domain/model/value-objects/TimelineEventId.js';
import { createAnalystDecisionId } from '../../../../src/modules/case-management/domain/model/value-objects/AnalystDecisionId.js';
import { createEnforcementActionId } from '../../../../src/modules/case-management/domain/model/value-objects/EnforcementActionId.js';
import { createEnforcementActionType } from '../../../../src/modules/case-management/domain/model/value-objects/EnforcementActionType.js';
import { InMemoryCaseRepository } from '../../../helpers/case-management/InMemoryCaseRepository.js';
import { InMemoryTimelineRecorder } from '../../../helpers/case-management/InMemoryTimelineRecorder.js';
import { InMemoryCaseManagementAuditRecorder } from '../../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';
import { InMemoryAnalystDecisionRepository } from '../../../helpers/case-management/InMemoryAnalystDecisionRepository.js';
import { InMemoryEnforcementActionRepository } from '../../../helpers/case-management/InMemoryEnforcementActionRepository.js';
import { InMemoryApprovalRequestRepository } from '../../../helpers/case-management/InMemoryApprovalRequestRepository.js';
import { InMemoryAssigneeDirectory } from '../../../helpers/case-management/InMemoryAssigneeDirectory.js';
import { InMemoryCaseManagementNotificationSender } from '../../../helpers/case-management/InMemoryCaseManagementNotificationSender.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/case-management/infrastructure/PassthroughUnitOfWork.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { CaseManagementError } from '../../../../src/modules/case-management/domain/errors/CaseManagementError.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_1 = oid('org-1');
const ORG_2 = oid('org-2');
const CASE_ID = createCaseId(oid('case-decision-1'));

const ANALYST_ID = oid('analyst-1');
const SUPERVISOR_ID = oid('supervisor-1');

const ANALYST = createAuthContext({
  userId: ANALYST_ID,
  organizationId: ORG_1,
  actorType: 'USER',
  roleId: 'ANALYST',
});
const SUPERVISOR = createAuthContext({
  userId: SUPERVISOR_ID,
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
const AUDITOR = createAuthContext({
  userId: oid('auditor-1'),
  organizationId: ORG_1,
  actorType: 'USER',
  roleId: 'AUDITOR',
});

function buildCase(overrides: { organizationId?: string; deletedAt?: typeof NOW | null; status?: 'OPEN' | 'IN_REVIEW' } = {}): Case {
  let kase = Case.create({
    id: CASE_ID,
    organizationId: overrides.organizationId ?? ORG_1,
    customerId: 'customer-1',
    riskScore: createRiskScore(70),
    priority: 'HIGH',
    now: NOW,
  });
  if (overrides.status === 'IN_REVIEW') {
    kase = kase.transitionTo('IN_REVIEW', NOW);
  }
  if (overrides.deletedAt != null) {
    kase = Case.rehydrate({
      id: kase.id,
      organizationId: kase.organizationId,
      customerId: kase.customerId,
      customerEmail: kase.customerEmail,
      bridgeUserId: kase.bridgeUserId,
      bridgeWallet: kase.bridgeWallet,
      stripeCustomerId: kase.stripeCustomerId,
      finturuReference: kase.finturuReference,
      finturuCacheSnapshot: kase.finturuCacheSnapshot,
      riskScore: kase.riskScore,
      status: kase.status,
      priority: kase.priority,
      assignedTo: kase.assignedTo,
      dueDate: kase.dueDate,
      tags: kase.tags,
      createdAt: kase.createdAt,
      updatedAt: kase.updatedAt,
      deletedAt: overrides.deletedAt,
    });
  }
  return kase;
}

function buildUseCase(seed?: Case) {
  const cases = new InMemoryCaseRepository();
  if (seed !== undefined) {
    void cases.save(seed);
  }
  const decisions = new InMemoryAnalystDecisionRepository();
  const enforcementActions = new InMemoryEnforcementActionRepository();
  const approvalRequests = new InMemoryApprovalRequestRepository();
  const timelineRecorder = new InMemoryTimelineRecorder();
  const auditRecorder = new InMemoryCaseManagementAuditRecorder();
  const notificationSender = new InMemoryCaseManagementNotificationSender();
  const assigneeDirectory = new InMemoryAssigneeDirectory();
  // Dos supervisores en el inquilino, uno de ellos el propio analista que
  // firma las pruebas: sirve para comprobar que al solicitante no se le avisa.
  assigneeDirectory.allowRoleRecipients(ORG_1, 'SUPERVISOR', [SUPERVISOR_ID, ANALYST_ID]);
  const recordAnalystDecision = createRecordAnalystDecisionUseCase({
    cases,
    decisions,
    enforcementActions,
    approvalRequests,
    timelineRecorder,
    auditRecorder,
    notificationSender,
    assigneeDirectory,
    unitOfWork: new PassthroughUnitOfWork(),
    clock: new FixedClock(NOW),
    generateAnalystDecisionId,
    generateEnforcementActionId,
    generateApprovalRequestId,
    generateTimelineEventId,
  });
  return {
    recordAnalystDecision,
    cases,
    decisions,
    enforcementActions,
    approvalRequests,
    timelineRecorder,
    auditRecorder,
    notificationSender,
  };
}

describe('createRecordAnalystDecisionUseCase', () => {
  it('records FRAUD_CONFIRMED with DECISION_MADE timeline, audit, PENDING action, and unchanged case status', async () => {
    const seed = buildCase({ status: 'IN_REVIEW' });
    const { recordAnalystDecision, cases, decisions, enforcementActions, timelineRecorder, auditRecorder } =
      buildUseCase(seed);

    const result = await recordAnalystDecision({
      auth: ANALYST,
      caseId: CASE_ID,
      decision: 'FRAUD_CONFIRMED',
      confidence: 90,
      comment: 'confirmed mule account',
      actionType: 'BLOCK',
      targetType: 'CUSTOMER',
      targetId: 'customer-1',
    });

    expect(result.decision.decision).toBe('FRAUD_CONFIRMED');
    expect(result.decision.confidence).toBe(90);
    expect(result.decision.comment).toBe('confirmed mule account');
    expect(result.decision.caseId).toBe(CASE_ID);
    expect(result.decision.organizationId).toBe(ORG_1);
    expect(result.decision.createdBy).toBe(oid('analyst-1'));
    expect(decisions.all()).toHaveLength(1);

    expect(result.enforcementAction).not.toBeNull();
    expect(result.enforcementAction?.status).toBe('PENDING');
    expect(result.enforcementAction?.actionType).toBe('BLOCK');
    expect(result.enforcementAction?.targetType).toBe('CUSTOMER');
    expect(result.enforcementAction?.targetId).toBe('customer-1');
    expect(result.enforcementAction?.analystDecisionId).toBe(result.decision.id);
    expect(enforcementActions.all()).toHaveLength(1);

    const events = timelineRecorder.all();
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe('DECISION_MADE');
    expect(events[0]?.newValue).toBe('FRAUD_CONFIRMED');
    expect(events[0]?.createdBy).toBe(oid('analyst-1'));

    const audits = auditRecorder.all();
    expect(audits).toHaveLength(1);
    expect(audits[0]?.action).toBe('RECORD_ANALYST_DECISION');
    expect(audits[0]?.resource).toBe('case');
    expect(audits[0]?.detail).toMatchObject({
      decision: 'FRAUD_CONFIRMED',
      confidence: 90,
      enforcementActionId: result.enforcementAction?.id,
    });

    expect(cases.all()[0]?.status).toBe('IN_REVIEW');
    expect(result.caseStatus).toBe('IN_REVIEW');
  });

  it('records FALSE_POSITIVE without creating an enforcement action', async () => {
    const { recordAnalystDecision, decisions, enforcementActions, timelineRecorder } = buildUseCase(buildCase());

    const result = await recordAnalystDecision({
      auth: SUPERVISOR,
      caseId: CASE_ID,
      decision: 'FALSE_POSITIVE',
      confidence: 40,
      comment: 'benign pattern',
    });

    expect(result.decision.decision).toBe('FALSE_POSITIVE');
    expect(result.enforcementAction).toBeNull();
    expect(decisions.all()).toHaveLength(1);
    expect(enforcementActions.all()).toHaveLength(0);
    expect(timelineRecorder.all()[0]?.eventType).toBe('DECISION_MADE');
    expect(timelineRecorder.all()[0]?.newValue).toBe('FALSE_POSITIVE');
  });

  it('records INCONCLUSIVE without creating an enforcement action', async () => {
    const { recordAnalystDecision, enforcementActions } = buildUseCase(buildCase());

    const result = await recordAnalystDecision({
      auth: SUPERVISOR,
      caseId: CASE_ID,
      decision: 'INCONCLUSIVE',
      confidence: 10,
      comment: 'needs more data',
    });

    expect(result.decision.decision).toBe('INCONCLUSIVE');
    expect(result.enforcementAction).toBeNull();
    expect(enforcementActions.all()).toHaveLength(0);
  });

  it('allows concurrent open PENDING/APPROVED actions on the same case', async () => {
    const { recordAnalystDecision, enforcementActions } = buildUseCase(buildCase());
    const existingPending = EnforcementAction.create({
      id: createEnforcementActionId(oid('action-existing')),
      caseId: CASE_ID,
      organizationId: ORG_1,
      analystDecisionId: createAnalystDecisionId(oid('decision-existing')),
      actionType: createEnforcementActionType('RESTRICT'),
      targetType: 'WALLET',
      targetId: 'wallet-1',
      createdBy: oid('analyst-0'),
      now: NOW,
    });
    await enforcementActions.save(existingPending);

    const result = await recordAnalystDecision({
      auth: ANALYST,
      caseId: CASE_ID,
      decision: 'FRAUD_CONFIRMED',
      confidence: 80,
      comment: 'second action',
      actionType: 'SUSPEND',
      targetType: 'CUSTOMER',
      targetId: 'customer-1',
    });

    expect(enforcementActions.all()).toHaveLength(2);
    expect(enforcementActions.all().map((a) => a.status).sort()).toEqual(['PENDING', 'PENDING']);
    expect(result.enforcementAction?.actionType).toBe('SUSPEND');
  });

  /**
   * ADMIN incluido: dictaminar es instruir el expediente, y quien administra
   * al equipo no lo instruye (SoD, ver `shared/kernel/AccessTier.ts`).
   */
  /* ---------------------------------------------------------------------- */
  /* Cuatro ojos (ENF-002)                                                    */
  /* ---------------------------------------------------------------------- */

  /**
   * La solicitud de doble firma tiene que nacer AQUI, con la sancion.
   *
   * Antes se creaba perezosamente al aprobarla, lo que dejaba el control sin
   * efecto: no habia nada que revisar hasta que alguien ya habia aprobado.
   */
  it('opens a PENDING approval request alongside the sanction, in the same write', async () => {
    const { recordAnalystDecision, approvalRequests, enforcementActions } = buildUseCase(
      buildCase({ status: 'IN_REVIEW' }),
    );

    const result = await recordAnalystDecision({
      auth: ANALYST,
      caseId: CASE_ID,
      decision: 'FRAUD_CONFIRMED',
      confidence: 90,
      comment: 'patrón confirmado',
      actionType: 'BLOCK',
      targetType: 'WALLET',
      targetId: '0xabc',
    });

    expect(result.approvalRequest).not.toBeNull();
    expect(result.approvalRequest!.status).toBe('PENDING');
    expect(result.approvalRequest!.requesterId).toBe(ANALYST_ID);
    expect(result.approvalRequest!.reviewerId).toBeNull();
    expect(result.approvalRequest!.enforcementActionId).toBe(result.enforcementAction!.id);
    expect(approvalRequests.all()).toHaveLength(1);
    expect(enforcementActions.all()[0]?.status).toBe('PENDING');
  });

  /** Avisar al solicitante seria ofrecerle algo que el agregado le va a negar. */
  it('notifies the other supervisors, never the requester', async () => {
    const { recordAnalystDecision, notificationSender } = buildUseCase(
      buildCase({ status: 'IN_REVIEW' }),
    );

    const result = await recordAnalystDecision({
      auth: ANALYST,
      caseId: CASE_ID,
      decision: 'FRAUD_CONFIRMED',
      confidence: 90,
      comment: 'patrón confirmado',
      actionType: 'SUSPEND',
      targetType: 'CUSTOMER',
      targetId: '1887',
    });

    const sent = notificationSender.all();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.recipientUserId).toBe(SUPERVISOR_ID);
    expect(sent[0]?.alertType).toBe('APROBACION_PENDIENTE');
    expect(sent[0]?.context).toMatchObject({
      caseId: CASE_ID,
      approvalRequestId: result.approvalRequest!.id,
      requesterId: ANALYST_ID,
      actionType: 'SUSPEND',
    });
  });

  /**
   * REVIEW solo marca a un cliente para mirarlo con calma: no restringe nada,
   * asi que exigirle doble firma solo llenaria la cola del supervisor de ruido.
   */
  it('skips dual control for REVIEW, which restricts nothing', async () => {
    const { recordAnalystDecision, approvalRequests, notificationSender } = buildUseCase(
      buildCase({ status: 'IN_REVIEW' }),
    );

    const result = await recordAnalystDecision({
      auth: ANALYST,
      caseId: CASE_ID,
      decision: 'FRAUD_CONFIRMED',
      confidence: 40,
      comment: 'merece una segunda mirada',
      actionType: 'REVIEW',
      targetType: 'CUSTOMER',
      targetId: '1887',
    });

    expect(result.enforcementAction).not.toBeNull();
    expect(result.approvalRequest).toBeNull();
    expect(approvalRequests.all()).toHaveLength(0);
    expect(notificationSender.all()).toHaveLength(0);
  });

  it('opens no approval request when the decision carries no sanction', async () => {
    const { recordAnalystDecision, approvalRequests, notificationSender } = buildUseCase(
      buildCase({ status: 'IN_REVIEW' }),
    );

    const result = await recordAnalystDecision({
      auth: ANALYST,
      caseId: CASE_ID,
      decision: 'FALSE_POSITIVE',
      confidence: 80,
      comment: 'cliente legítimo',
    });

    expect(result.enforcementAction).toBeNull();
    expect(result.approvalRequest).toBeNull();
    expect(approvalRequests.all()).toHaveLength(0);
    expect(notificationSender.all()).toHaveLength(0);
  });

  it.each([
    ['AUDITOR', () => AUDITOR],
    ['ADMIN', () => ADMIN],
  ])('rejects %s with FORBIDDEN_ROLE', async (_role, actor) => {
    const { recordAnalystDecision, decisions, timelineRecorder, auditRecorder } = buildUseCase(buildCase());

    await expect(
      recordAnalystDecision({
        auth: actor(),
        caseId: CASE_ID,
        decision: 'FALSE_POSITIVE',
        confidence: 50,
        comment: 'nope',
      }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN_ROLE',
    } satisfies Partial<CaseManagementError>);

    expect(decisions.all()).toHaveLength(0);
    expect(timelineRecorder.all()).toHaveLength(0);
    expect(auditRecorder.all()).toHaveLength(0);
  });

  it('rejects FRAUD_CONFIRMED without action fields', async () => {
    const { recordAnalystDecision, decisions, enforcementActions } = buildUseCase(buildCase());

    await expect(
      recordAnalystDecision({
        auth: ANALYST,
        caseId: CASE_ID,
        decision: 'FRAUD_CONFIRMED',
        confidence: 90,
        comment: 'missing action',
      }),
    ).rejects.toMatchObject({
      code: 'INVARIANT_VIOLATION',
    } satisfies Partial<CaseManagementError>);

    expect(decisions.all()).toHaveLength(0);
    expect(enforcementActions.all()).toHaveLength(0);
  });

  it('returns CASE_NOT_FOUND for soft-deleted cases and does not mutate status on success path already covered', async () => {
    const { recordAnalystDecision } = buildUseCase(buildCase({ deletedAt: NOW }));

    await expect(
      recordAnalystDecision({
        auth: ANALYST,
        caseId: CASE_ID,
        decision: 'INCONCLUSIVE',
        confidence: 1,
        comment: 'gone',
      }),
    ).rejects.toMatchObject({
      code: 'CASE_NOT_FOUND',
    } satisfies Partial<CaseManagementError>);
  });

  it('rejects cross-tenant access', async () => {
    const { recordAnalystDecision } = buildUseCase(buildCase({ organizationId: ORG_2 }));

    await expect(
      recordAnalystDecision({
        auth: ANALYST,
        caseId: CASE_ID,
        decision: 'FALSE_POSITIVE',
        confidence: 20,
        comment: 'wrong org',
      }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN_CROSS_TENANT',
    } satisfies Partial<CaseManagementError>);
  });
});
