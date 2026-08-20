import { oid } from '../../../support/oid.js';
import { createBulkCaseActionUseCase } from '../../../../src/modules/case-management/application/BulkCaseAction.js';
import { Case } from '../../../../src/modules/case-management/domain/model/aggregates/Case.js';
import { createCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { createRiskScore } from '../../../../src/modules/case-management/domain/model/value-objects/RiskScore.js';
import { createAssignedTo } from '../../../../src/modules/case-management/domain/model/value-objects/AssignedTo.js';
import { generateTimelineEventId } from '../../../../src/modules/case-management/domain/model/value-objects/TimelineEventId.js';
import { InMemoryCaseRepository } from '../../../helpers/case-management/InMemoryCaseRepository.js';
import { InMemoryTimelineRecorder } from '../../../helpers/case-management/InMemoryTimelineRecorder.js';
import { InMemoryCaseManagementAuditRecorder } from '../../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';
import { InMemoryAssigneeDirectory } from '../../../helpers/case-management/InMemoryAssigneeDirectory.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/case-management/infrastructure/PassthroughUnitOfWork.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { CaseManagementError } from '../../../../src/modules/case-management/domain/errors/CaseManagementError.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_1 = oid('org-1');
const ORG_2 = oid('org-2');
const CASE_A = oid('case-a');
const CASE_B = oid('case-b');
const ANALYST_ID = oid('analyst-99');

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

function buildCase(
  id: string,
  overrides: { organizationId?: string; priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'; tags?: string[]; deletedAt?: typeof NOW | null } = {},
): Case {
  const kase = Case.create({
    id: createCaseId(id),
    organizationId: overrides.organizationId ?? ORG_1,
    customerId: 'customer-1',
    riskScore: createRiskScore(50),
    priority: overrides.priority ?? 'MEDIUM',
    tags: overrides.tags ?? ['fraud'],
    now: NOW,
  });
  if (overrides.deletedAt == null) {
    return kase;
  }
  return Case.rehydrate({ ...kase.toProps(), deletedAt: overrides.deletedAt });
}

function buildUseCase(seeds: Case[] = []) {
  const cases = new InMemoryCaseRepository();
  for (const seed of seeds) {
    void cases.save(seed);
  }
  const timelineRecorder = new InMemoryTimelineRecorder();
  const auditRecorder = new InMemoryCaseManagementAuditRecorder();
  const assigneeDirectory = new InMemoryAssigneeDirectory();
  assigneeDirectory.allow(ORG_1, createAssignedTo('USER', ANALYST_ID));

  const bulkCaseAction = createBulkCaseActionUseCase({
    cases,
    timelineRecorder,
    auditRecorder,
    assigneeDirectory,
    unitOfWork: new PassthroughUnitOfWork(),
    clock: new FixedClock(NOW),
    generateTimelineEventId,
  });

  return { bulkCaseAction, cases, timelineRecorder, auditRecorder, assigneeDirectory };
}

describe('createBulkCaseActionUseCase', () => {
  it('CHANGE_PRIORITY across multiple cases records PRIORITY_CHANGED + BULK_CASE_ACTION per case', async () => {
    const { bulkCaseAction, cases, timelineRecorder, auditRecorder } = buildUseCase([
      buildCase(CASE_A, { priority: 'LOW' }),
      buildCase(CASE_B, { priority: 'MEDIUM' }),
    ]);

    const result = await bulkCaseAction({
      auth: ANALYST,
      caseIds: [CASE_A, CASE_B],
      action: { type: 'CHANGE_PRIORITY', priority: 'HIGH' },
    });

    expect(result.cases.map((c) => c.priority)).toEqual(['HIGH', 'HIGH']);
    expect(result.changedCaseIds).toEqual([CASE_A, CASE_B]);
    expect(cases.all().every((c) => c.priority === 'HIGH')).toBe(true);
    expect(timelineRecorder.all()).toHaveLength(2);
    expect(timelineRecorder.all().every((e) => e.eventType === 'PRIORITY_CHANGED')).toBe(true);
    expect(auditRecorder.all()).toHaveLength(2);
    expect(auditRecorder.all()[0]?.action).toBe('BULK_CASE_ACTION');
    expect(auditRecorder.all()[0]?.detail).toMatchObject({
      bulkActionType: 'CHANGE_PRIORITY',
      newPriority: 'HIGH',
    });
  });

  it('ADD_TAGS merges without duplicating existing tags', async () => {
    const { bulkCaseAction, cases, timelineRecorder } = buildUseCase([
      buildCase(CASE_A, { tags: ['fraud'] }),
    ]);

    const result = await bulkCaseAction({
      auth: ANALYST,
      caseIds: [CASE_A],
      action: { type: 'ADD_TAGS', tags: ['fraud', 'aml', 'aml'] },
    });

    expect(result.cases[0]?.tags).toEqual(['fraud', 'aml']);
    expect(cases.all()[0]?.tags).toEqual(['fraud', 'aml']);
    expect(timelineRecorder.all()[0]?.eventType).toBe('TAGS_UPDATED');
  });

  it('ASSIGN sets the assignee and records ASSIGNED', async () => {
    const { bulkCaseAction, cases } = buildUseCase([buildCase(CASE_A)]);

    const result = await bulkCaseAction({
      auth: ANALYST,
      caseIds: [CASE_A],
      action: { type: 'ASSIGN', assignedToType: 'USER', assignedToId: ANALYST_ID },
    });

    expect(result.cases[0]?.assignedTo).toEqual({ type: 'USER', id: ANALYST_ID });
    expect(cases.all()[0]?.assignedTo?.id).toBe(ANALYST_ID);
  });

  it('does NOT recompute SLA on bulk priority change (dueDate untouched)', async () => {
    const withDue = buildCase(CASE_A, { priority: 'LOW' }).withDueDate(NOW, NOW);
    const { bulkCaseAction } = buildUseCase([withDue]);

    const result = await bulkCaseAction({
      auth: ANALYST,
      caseIds: [CASE_A],
      action: { type: 'CHANGE_PRIORITY', priority: 'CRITICAL' },
    });

    expect(result.cases[0]?.priority).toBe('CRITICAL');
    expect(result.cases[0]?.dueDate).toEqual(NOW);
  });

  it('skips no-op cases (already at target) without timeline/audit noise', async () => {
    const { bulkCaseAction, timelineRecorder, auditRecorder } = buildUseCase([
      buildCase(CASE_A, { priority: 'HIGH' }),
      buildCase(CASE_B, { priority: 'LOW' }),
    ]);

    const result = await bulkCaseAction({
      auth: ANALYST,
      caseIds: [CASE_A, CASE_B],
      action: { type: 'CHANGE_PRIORITY', priority: 'HIGH' },
    });

    expect(result.changedCaseIds).toEqual([CASE_B]);
    expect(result.cases).toHaveLength(2);
    expect(timelineRecorder.all()).toHaveLength(1);
    expect(auditRecorder.all()).toHaveLength(1);
  });

  it('is all-or-nothing: a missing case aborts the batch (CASE_NOT_FOUND) with no writes', async () => {
    const { bulkCaseAction, cases, timelineRecorder, auditRecorder } = buildUseCase([
      buildCase(CASE_A, { priority: 'LOW' }),
    ]);

    await expect(
      bulkCaseAction({
        auth: ANALYST,
        caseIds: [CASE_A, oid('case-missing')],
        action: { type: 'CHANGE_PRIORITY', priority: 'HIGH' },
      }),
    ).rejects.toMatchObject({ code: 'CASE_NOT_FOUND' });

    expect(cases.all()[0]?.priority).toBe('LOW');
    expect(timelineRecorder.all()).toHaveLength(0);
    expect(auditRecorder.all()).toHaveLength(0);
  });

  it('rejects a cross-tenant case with FORBIDDEN_CROSS_TENANT', async () => {
    const { bulkCaseAction } = buildUseCase([buildCase(CASE_A, { organizationId: ORG_2 })]);

    await expect(
      bulkCaseAction({
        auth: ANALYST,
        caseIds: [CASE_A],
        action: { type: 'CHANGE_PRIORITY', priority: 'HIGH' },
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_CROSS_TENANT' });
  });

  it('rejects ASSIGN when the assignee does not belong to the org', async () => {
    const { bulkCaseAction } = buildUseCase([buildCase(CASE_A)]);

    await expect(
      bulkCaseAction({
        auth: ANALYST,
        caseIds: [CASE_A],
        action: { type: 'ASSIGN', assignedToType: 'USER', assignedToId: oid('stranger') },
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_CROSS_TENANT' });
  });

  it('rejects AUDITOR with FORBIDDEN_ROLE', async () => {
    const { bulkCaseAction } = buildUseCase([buildCase(CASE_A)]);

    await expect(
      bulkCaseAction({
        auth: AUDITOR,
        caseIds: [CASE_A],
        action: { type: 'CHANGE_PRIORITY', priority: 'HIGH' },
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_ROLE' });
  });

  it('rejects an empty case selection with INVARIANT_VIOLATION', async () => {
    const { bulkCaseAction } = buildUseCase([]);

    await expect(
      bulkCaseAction({
        auth: ANALYST,
        caseIds: [],
        action: { type: 'CHANGE_PRIORITY', priority: 'HIGH' },
      }),
    ).rejects.toMatchObject({ code: 'INVARIANT_VIOLATION' } satisfies Partial<CaseManagementError>);
  });

  it('de-duplicates repeated case ids', async () => {
    const { bulkCaseAction, auditRecorder } = buildUseCase([buildCase(CASE_A, { priority: 'LOW' })]);

    const result = await bulkCaseAction({
      auth: ANALYST,
      caseIds: [CASE_A, CASE_A],
      action: { type: 'CHANGE_PRIORITY', priority: 'HIGH' },
    });

    expect(result.cases).toHaveLength(1);
    expect(auditRecorder.all()).toHaveLength(1);
  });
});
