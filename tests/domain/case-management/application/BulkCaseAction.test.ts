import {
  createBulkCaseActionUseCase,
  MAX_BULK_CASES,
} from '../../../../src/modules/case-management/application/BulkCaseAction.js';
import { createAssignCaseUseCase } from '../../../../src/modules/case-management/application/AssignCase.js';
import { createReclassifyCaseUseCase } from '../../../../src/modules/case-management/application/ReclassifyCase.js';
import { createInitializeCaseSlaService } from '../../../../src/modules/case-management/application/InitializeCaseSla.js';
import { InMemoryCaseRepository } from '../../../helpers/case-management/InMemoryCaseRepository.js';
import { InMemoryTimelineRecorder } from '../../../helpers/case-management/InMemoryTimelineRecorder.js';
import { InMemoryCaseManagementAuditRecorder } from '../../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';
import { InMemoryCaseSlaTrackingRepository } from '../../../helpers/case-management/InMemoryCaseSlaTrackingRepository.js';
import { InMemoryOrganizationFraudConfigRepository } from '../../../helpers/case-management/InMemoryOrganizationFraudConfigRepository.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/case-management/infrastructure/PassthroughUnitOfWork.js';
import { Case } from '../../../../src/modules/case-management/domain/model/aggregates/Case.js';
import { generateCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { createRiskScore } from '../../../../src/modules/case-management/domain/model/value-objects/RiskScore.js';
import { createCasePriority } from '../../../../src/modules/case-management/domain/model/value-objects/CasePriority.js';
import { generateCaseSlaTrackingId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseSlaTrackingId.js';
import { generateTimelineEventId } from '../../../../src/modules/case-management/domain/model/value-objects/TimelineEventId.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { CaseManagementError } from '../../../../src/modules/case-management/domain/errors/CaseManagementError.js';
import type { AssigneeDirectory, ResolvedActor } from '../../../../src/modules/case-management/domain/ports/AssigneeDirectory.js';

const NOW = fromDate(new Date('2026-09-01T08:00:00.000Z'));
const ORG_1 = createAuthContext({ userId: 'analyst-1', organizationId: 'org-1', actorType: 'USER' });

class AlwaysFoundDirectory implements AssigneeDirectory {
  async userExists(): Promise<boolean> {
    return true;
  }
  async roleExists(): Promise<boolean> {
    return true;
  }
  async resolveActors(_org: string, ids: readonly string[]): Promise<readonly ResolvedActor[]> {
    return ids.map((id) => ({ id, kind: 'USER' as const, name: id }));
  }
}

function build(caseSpecs: { organizationId?: string; priority?: string; tags?: string[] }[]) {
  const cases = new InMemoryCaseRepository();
  const timelineRecorder = new InMemoryTimelineRecorder();
  const auditRecorder = new InMemoryCaseManagementAuditRecorder();
  const unitOfWork = new PassthroughUnitOfWork();
  const clock = new FixedClock(NOW);

  const seeded = caseSpecs.map((spec) => {
    const kase = Case.create({
      id: generateCaseId(),
      organizationId: spec.organizationId ?? 'org-1',
      customerId: `customer-${Math.random().toString(16).slice(2, 8)}`,
      riskScore: createRiskScore(50),
      priority: createCasePriority(spec.priority ?? 'LOW'),
      tags: spec.tags ?? [],
      now: NOW,
    });
    void cases.save(kase);
    return kase;
  });

  const shared = {
    cases,
    timelineRecorder,
    unitOfWork,
    clock,
    generateTimelineEventId,
    auditRecorder,
  };

  const assignCase = createAssignCaseUseCase({
    ...shared,
    assigneeDirectory: new AlwaysFoundDirectory(),
  });

  const reclassifyCase = createReclassifyCaseUseCase({
    ...shared,
    initializeCaseSla: createInitializeCaseSlaService({
      slaTracking: new InMemoryCaseSlaTrackingRepository(),
      fraudConfig: new InMemoryOrganizationFraudConfigRepository(),
      generateCaseSlaTrackingId,
    }),
  });

  const bulkCaseAction = createBulkCaseActionUseCase({ cases, assignCase, reclassifyCase });

  return { cases, timelineRecorder, auditRecorder, seeded, bulkCaseAction };
}

describe('createBulkCaseActionUseCase', () => {
  it('reassigns every case in the batch', async () => {
    const { seeded, cases, bulkCaseAction } = build([{}, {}, {}]);

    const result = await bulkCaseAction({
      auth: ORG_1,
      caseIds: seeded.map((k) => k.id),
      action: 'REASSIGN',
      assignedTo: { type: 'USER', id: 'analyst-9' },
    });

    expect(result.succeeded).toBe(3);
    expect(result.failed).toBe(0);
    for (const kase of seeded) {
      const stored = await cases.findById(kase.id);
      expect(stored?.assignedTo?.id).toBe('analyst-9');
    }
  });

  it('releases a whole batch to the general inbox with a null assignee', async () => {
    const { seeded, cases, bulkCaseAction } = build([{}, {}]);
    await bulkCaseAction({
      auth: ORG_1,
      caseIds: seeded.map((k) => k.id),
      action: 'REASSIGN',
      assignedTo: { type: 'USER', id: 'analyst-9' },
    });

    const result = await bulkCaseAction({
      auth: ORG_1,
      caseIds: seeded.map((k) => k.id),
      action: 'REASSIGN',
      assignedTo: null,
    });

    expect(result.succeeded).toBe(2);
    expect((await cases.findById(seeded[0]!.id))?.assignedTo).toBeNull();
  });

  it('sets the priority and lets the single-case rules recompute each deadline', async () => {
    const { seeded, cases, bulkCaseAction } = build([{ priority: 'LOW' }, { priority: 'MEDIUM' }]);

    const result = await bulkCaseAction({
      auth: ORG_1,
      caseIds: seeded.map((k) => k.id),
      action: 'SET_PRIORITY',
      priority: 'CRITICAL',
    });

    expect(result.succeeded).toBe(2);
    for (const kase of seeded) {
      const stored = await cases.findById(kase.id);
      expect(stored?.priority).toBe('CRITICAL');
      // La ventana CRITICAL por defecto son 30 minutos: el lote hereda el
      // recalculo de SLA sin reimplementarlo.
      expect(stored?.dueDate).toBe('2026-09-01T08:30:00.000Z');
    }
  });

  it('adds tags on top of the existing ones instead of replacing them', async () => {
    const { seeded, cases, bulkCaseAction } = build([{ tags: ['AML'] }, { tags: ['CHARGEBACK'] }]);

    await bulkCaseAction({
      auth: ORG_1,
      caseIds: seeded.map((k) => k.id),
      action: 'ADD_TAGS',
      tags: ['REVISION_2026'],
    });

    expect((await cases.findById(seeded[0]!.id))?.tags).toEqual(['AML', 'REVISION_2026']);
    expect((await cases.findById(seeded[1]!.id))?.tags).toEqual(['CHARGEBACK', 'REVISION_2026']);
  });

  it('does not duplicate a tag a case already carries', async () => {
    const { seeded, cases, bulkCaseAction } = build([{ tags: ['AML'] }]);

    await bulkCaseAction({ auth: ORG_1, caseIds: [seeded[0]!.id], action: 'ADD_TAGS', tags: ['AML'] });

    expect((await cases.findById(seeded[0]!.id))?.tags).toEqual(['AML']);
  });

  it('removes only the requested tags', async () => {
    const { seeded, cases, bulkCaseAction } = build([{ tags: ['AML', 'SANCTIONS', 'CHARGEBACK'] }]);

    await bulkCaseAction({
      auth: ORG_1,
      caseIds: [seeded[0]!.id],
      action: 'REMOVE_TAGS',
      tags: ['SANCTIONS'],
    });

    expect((await cases.findById(seeded[0]!.id))?.tags).toEqual(['AML', 'CHARGEBACK']);
  });

  it('keeps the successful cases when one in the batch fails', async () => {
    // El tercero pertenece a otro inquilino: debe fallar sin arrastrar a los otros.
    const { seeded, cases, bulkCaseAction } = build([{}, {}, { organizationId: 'org-2' }]);

    const result = await bulkCaseAction({
      auth: ORG_1,
      caseIds: seeded.map((k) => k.id),
      action: 'REASSIGN',
      assignedTo: { type: 'USER', id: 'analyst-9' },
    });

    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(1);
    expect((await cases.findById(seeded[0]!.id))?.assignedTo?.id).toBe('analyst-9');
    expect((await cases.findById(seeded[2]!.id))?.assignedTo).toBeNull();
  });

  it('reports per-case outcomes so the UI can name what failed', async () => {
    const { seeded, bulkCaseAction } = build([{}, { organizationId: 'org-2' }]);

    const result = await bulkCaseAction({
      auth: ORG_1,
      caseIds: seeded.map((k) => k.id),
      action: 'SET_PRIORITY',
      priority: 'HIGH',
    });

    expect(result.outcomes).toHaveLength(2);
    expect(result.outcomes[0]).toMatchObject({ caseId: seeded[0]!.id, ok: true });
    expect(result.outcomes[1]?.ok).toBe(false);
    expect(result.outcomes[1]?.errorCode).toBeDefined();
  });

  it('deduplicates repeated ids so a case is not written twice', async () => {
    const { seeded, timelineRecorder, bulkCaseAction } = build([{ priority: 'LOW' }]);
    const id = seeded[0]!.id;

    const result = await bulkCaseAction({
      auth: ORG_1,
      caseIds: [id, id, id],
      action: 'SET_PRIORITY',
      priority: 'HIGH',
    });

    expect(result.outcomes).toHaveLength(1);
    expect(timelineRecorder.all()).toHaveLength(1);
  });

  it('rejects an empty batch', async () => {
    const { bulkCaseAction } = build([{}]);

    await expect(
      bulkCaseAction({ auth: ORG_1, caseIds: [], action: 'SET_PRIORITY', priority: 'HIGH' }),
    ).rejects.toThrow(CaseManagementError);
  });

  it('rejects a batch above the cap rather than holding the request open', async () => {
    const { bulkCaseAction } = build([{}]);
    const tooMany = Array.from({ length: MAX_BULK_CASES + 1 }, (_, i) => `case-${i}`);

    await expect(
      bulkCaseAction({ auth: ORG_1, caseIds: tooMany, action: 'SET_PRIORITY', priority: 'HIGH' }),
    ).rejects.toThrow(CaseManagementError);
  });
});
