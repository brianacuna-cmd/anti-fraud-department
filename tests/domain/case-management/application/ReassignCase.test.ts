import { oid } from '../../../support/oid.js';
import { createReassignCaseUseCase } from '../../../../src/modules/case-management/application/ReassignCase.js';
import type { AssignedTo } from '../../../../src/modules/case-management/domain/model/value-objects/AssignedTo.js';
import { Case } from '../../../../src/modules/case-management/domain/model/aggregates/Case.js';
import { createCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { createRiskScore } from '../../../../src/modules/case-management/domain/model/value-objects/RiskScore.js';
import { createAssignedTo } from '../../../../src/modules/case-management/domain/model/value-objects/AssignedTo.js';
import { generateTimelineEventId } from '../../../../src/modules/case-management/domain/model/value-objects/TimelineEventId.js';
import { InMemoryCaseRepository } from '../../../helpers/case-management/InMemoryCaseRepository.js';
import { InMemoryTimelineRecorder } from '../../../helpers/case-management/InMemoryTimelineRecorder.js';
import { InMemoryCaseManagementAuditRecorder } from '../../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';
import { InMemoryCaseManagementNotificationSender } from '../../../helpers/case-management/InMemoryCaseManagementNotificationSender.js';
import { InMemoryAssigneeDirectory } from '../../../helpers/case-management/InMemoryAssigneeDirectory.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/case-management/infrastructure/PassthroughUnitOfWork.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { CaseManagementError } from '../../../../src/modules/case-management/domain/errors/CaseManagementError.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_1 = oid('org-1');
const ORG_2 = oid('org-2');
const ANALYST = createAuthContext({
  userId: oid('analyst-1'),
  organizationId: ORG_1,
  actorType: 'USER',
  // Repartir trabajo es del ADMIN: el analista ya no elige su carga.
  roleId: 'ADMIN',
});
const CASE_ID = createCaseId(oid('case-1'));

function buildCase(overrides: { organizationId?: string; assignedTo?: AssignedTo | null; deletedAt?: typeof NOW | null } = {}): Case {
  const base = Case.create({
    id: CASE_ID,
    organizationId: overrides.organizationId ?? ORG_1,
    customerId: 'customer-1',
    riskScore: createRiskScore(50),
    priority: 'MEDIUM',
    now: NOW,
  });
  let kase = base;
  if (overrides.assignedTo !== undefined) {
    kase = kase.reassign(overrides.assignedTo, NOW);
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

function buildUseCase(seed?: Case, directorySeed?: AssignedTo[]) {
  const cases = new InMemoryCaseRepository();
  if (seed !== undefined) {
    void cases.save(seed);
  }
  const timelineRecorder = new InMemoryTimelineRecorder();
  const auditRecorder = new InMemoryCaseManagementAuditRecorder();
  const notificationSender = new InMemoryCaseManagementNotificationSender();
  const assigneeDirectory = new InMemoryAssigneeDirectory();
  for (const member of directorySeed ?? []) {
    assigneeDirectory.allow(ORG_1, member);
  }
  const reassignCase = createReassignCaseUseCase({
    cases,
    timelineRecorder,
    auditRecorder,
    unitOfWork: new PassthroughUnitOfWork(),
    clock: new FixedClock(NOW),
    generateTimelineEventId,
    assigneeDirectory,
    notificationSender,
  });
  return { reassignCase, cases, timelineRecorder, auditRecorder, assigneeDirectory, notificationSender };
}

describe('createReassignCaseUseCase (manual reassign)', () => {
  it('reassigns to a same-org USER and records ASSIGNED timeline + REASSIGN_CASE audit with trigger MANUAL', async () => {
    const target = createAssignedTo('USER', oid('analyst-2'));
    const { reassignCase, cases, timelineRecorder, auditRecorder } = buildUseCase(buildCase(), [target]);

    const result = await reassignCase({
      auth: ANALYST,
      caseId: CASE_ID,
      assignedToType: 'USER',
      assignedToId: oid('analyst-2'),
    });

    expect(result.assignedTo).toEqual({ type: 'USER', id: oid('analyst-2') });
    expect(cases.all()[0]?.assignedTo).toEqual({ type: 'USER', id: oid('analyst-2') });

    const events = timelineRecorder.all();
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe('ASSIGNED');
    expect(events[0]?.newValue).toBe(oid('analyst-2'));
    expect(events[0]?.createdBy).toBe(oid('analyst-1'));

    const audits = auditRecorder.all();
    expect(audits).toHaveLength(1);
    expect(audits[0]?.action).toBe('REASSIGN_CASE');
    expect(audits[0]?.resource).toBe('case');
    expect(audits[0]?.detail).toMatchObject({
      trigger: 'MANUAL',
      assignedToId: oid('analyst-2'),
      assignedToType: 'USER',
    });
  });

  it('sends CASO_ASIGNADO to the new USER assignee inside the same transaction (atomic)', async () => {
    const target = createAssignedTo('USER', oid('analyst-2'));
    const { reassignCase, notificationSender } = buildUseCase(buildCase(), [target]);

    await reassignCase({
      auth: ANALYST,
      caseId: CASE_ID,
      assignedToType: 'USER',
      assignedToId: oid('analyst-2'),
    });

    const requests = notificationSender.all();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      organizationId: ORG_1,
      recipientUserId: oid('analyst-2'),
      alertType: 'CASO_ASIGNADO',
    });
    expect(requests[0]?.context).toMatchObject({ caseId: CASE_ID });
  });

  it('sends no notification when reassigning to a ROLE with no active members', async () => {
    const target = createAssignedTo('ROLE', oid('role-1'));
    const { reassignCase, notificationSender, cases } = buildUseCase(buildCase(), [target]);

    const result = await reassignCase({
      auth: ANALYST,
      caseId: CASE_ID,
      assignedToType: 'ROLE',
      assignedToId: oid('role-1'),
    });

    expect(result.assignedTo).toEqual({ type: 'ROLE', id: oid('role-1') });
    expect(cases.all()[0]?.assignedTo).toEqual({ type: 'ROLE', id: oid('role-1') });
    expect(notificationSender.all()).toHaveLength(0);
  });

  it('fans out CASO_ASIGNADO to every active member when reassigning to a ROLE (PR3)', async () => {
    const target = createAssignedTo('ROLE', oid('role-1'));
    const { reassignCase, notificationSender, assigneeDirectory } = buildUseCase(buildCase(), [target]);
    assigneeDirectory.allowRoleRecipients(ORG_1, oid('role-1'), [oid('analyst-2'), oid('analyst-3')]);

    await reassignCase({
      auth: ANALYST,
      caseId: CASE_ID,
      assignedToType: 'ROLE',
      assignedToId: oid('role-1'),
    });

    const requests = notificationSender.all();
    expect(requests.map((request) => request.recipientUserId).sort()).toEqual(
      [oid('analyst-2'), oid('analyst-3')].sort(),
    );
    expect(requests.every((request) => request.alertType === 'CASO_ASIGNADO')).toBe(true);
  });

  it('returns CASE_NOT_FOUND when the case is soft-deleted', async () => {
    const target = createAssignedTo('USER', oid('analyst-2'));
    const { reassignCase, timelineRecorder, auditRecorder } = buildUseCase(
      buildCase({ deletedAt: NOW }),
      [target],
    );

    await expect(
      reassignCase({
        auth: ANALYST,
        caseId: CASE_ID,
        assignedToType: 'USER',
        assignedToId: oid('analyst-2'),
      }),
    ).rejects.toMatchObject({ code: 'CASE_NOT_FOUND' } satisfies Partial<CaseManagementError>);

    expect(timelineRecorder.all()).toHaveLength(0);
    expect(auditRecorder.all()).toHaveLength(0);
  });

  it('rejects when the assignee does not belong to the case organization', async () => {
    const { reassignCase, timelineRecorder, auditRecorder } = buildUseCase(buildCase(), []);

    await expect(
      reassignCase({
        auth: ANALYST,
        caseId: CASE_ID,
        assignedToType: 'USER',
        assignedToId: oid('other-org-user'),
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_CROSS_TENANT' } satisfies Partial<CaseManagementError>);

    expect(timelineRecorder.all()).toHaveLength(0);
    expect(auditRecorder.all()).toHaveLength(0);
  });

  it('rejects when the actor organization does not own the case', async () => {
    const target = createAssignedTo('USER', oid('analyst-2'));
    const { reassignCase, assigneeDirectory } = buildUseCase(buildCase({ organizationId: ORG_2 }), []);
    assigneeDirectory.allow(ORG_2, target);

    await expect(
      reassignCase({
        auth: ANALYST,
        caseId: CASE_ID,
        assignedToType: 'USER',
        assignedToId: oid('analyst-2'),
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_CROSS_TENANT' } satisfies Partial<CaseManagementError>);
  });

  it('rejects same-assignee reassignment with INVARIANT_VIOLATION (deterministic, no corrupt history)', async () => {
    const current = createAssignedTo('USER', oid('analyst-2'));
    const { reassignCase, timelineRecorder, auditRecorder } = buildUseCase(
      buildCase({ assignedTo: current }),
      [current],
    );

    await expect(
      reassignCase({
        auth: ANALYST,
        caseId: CASE_ID,
        assignedToType: 'USER',
        assignedToId: oid('analyst-2'),
      }),
    ).rejects.toMatchObject({ code: 'INVARIANT_VIOLATION' } satisfies Partial<CaseManagementError>);

    expect(timelineRecorder.all()).toHaveLength(0);
    expect(auditRecorder.all()).toHaveLength(0);
  });

  it('returns CASE_NOT_FOUND when the case id does not exist', async () => {
    const target = createAssignedTo('USER', oid('analyst-2'));
    const { reassignCase } = buildUseCase(undefined, [target]);

    await expect(
      reassignCase({
        auth: ANALYST,
        caseId: CASE_ID,
        assignedToType: 'USER',
        assignedToId: oid('analyst-2'),
      }),
    ).rejects.toMatchObject({ code: 'CASE_NOT_FOUND' } satisfies Partial<CaseManagementError>);
  });
});
