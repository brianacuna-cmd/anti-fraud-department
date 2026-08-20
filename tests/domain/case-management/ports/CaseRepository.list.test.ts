import { oid } from '../../../support/oid.js';
import { Case } from '../../../../src/modules/case-management/domain/model/aggregates/Case.js';
import { createCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { createRiskScore } from '../../../../src/modules/case-management/domain/model/value-objects/RiskScore.js';
import { createAssignedTo } from '../../../../src/modules/case-management/domain/model/value-objects/AssignedTo.js';
import type { CaseStatus } from '../../../../src/modules/case-management/domain/model/value-objects/CaseStatus.js';
import type { CasePriority } from '../../../../src/modules/case-management/domain/model/value-objects/CasePriority.js';
import { InMemoryCaseRepository } from '../../../helpers/case-management/InMemoryCaseRepository.js';
import { fromDate, type Instant } from '../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_1 = oid('org-1');
const ORG_2 = oid('org-2');
const EARLY = fromDate(new Date('2026-01-02T00:00:00.000Z'));
const MID = fromDate(new Date('2026-01-03T00:00:00.000Z'));
const LATE = fromDate(new Date('2026-01-04T00:00:00.000Z'));

interface SeedOverrides {
  readonly id?: string;
  readonly organizationId?: string;
  readonly status?: CaseStatus;
  readonly priority?: CasePriority;
  readonly riskScore?: number;
  readonly assignedToId?: string;
  readonly tags?: readonly string[];
  readonly dueDate?: Instant | null;
  readonly deletedAt?: Instant | null;
  readonly createdAt?: Instant;
}

function seedCase(overrides: SeedOverrides = {}): Case {
  const id = createCaseId(overrides.id ?? oid(`case-${Math.random().toString(36).slice(2, 8)}`));
  let kase = Case.create({
    id,
    organizationId: overrides.organizationId ?? ORG_1,
    customerId: 'customer-1',
    riskScore: createRiskScore(overrides.riskScore ?? 50),
    priority: overrides.priority ?? 'MEDIUM',
    tags: overrides.tags,
    now: overrides.createdAt ?? NOW,
  });

  if (overrides.assignedToId !== undefined) {
    kase = kase.reassign(createAssignedTo('USER', overrides.assignedToId), NOW);
  }
  if (overrides.dueDate !== undefined) {
    kase = kase.withDueDate(overrides.dueDate, NOW);
  }
  if (overrides.status !== undefined && overrides.status !== 'OPEN') {
    kase = Case.rehydrate({ ...kase.toProps(), status: overrides.status });
  }
  if (overrides.deletedAt != null) {
    kase = Case.rehydrate({ ...kase.toProps(), deletedAt: overrides.deletedAt });
  }
  return kase;
}

describe('CaseRepository.list (InMemory port contract)', () => {
  it('returns only matching non-deleted cases for the organization with pagination totals', async () => {
    const cases = new InMemoryCaseRepository();
    const openHigh = seedCase({ id: oid('c-open-high'), status: 'OPEN', priority: 'HIGH', riskScore: 80 });
    const openMed = seedCase({ id: oid('c-open-med'), status: 'OPEN', priority: 'MEDIUM', riskScore: 40 });
    const resolved = seedCase({ id: oid('c-resolved'), status: 'RESOLVED', priority: 'HIGH', riskScore: 90 });
    const otherOrg = seedCase({ id: oid('c-other'), organizationId: ORG_2, status: 'OPEN', priority: 'HIGH' });
    for (const k of [openHigh, openMed, resolved, otherOrg]) {
      await cases.save(k);
    }

    const page = await cases.list({
      organizationId: ORG_1,
      status: ['OPEN'],
      priority: ['HIGH'],
      limit: 10,
      offset: 0,
    });

    expect(page.total).toBe(1);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.id).toBe(oid('c-open-high'));
  });

  it('excludes soft-deleted cases from list results and totals', async () => {
    const cases = new InMemoryCaseRepository();
    await cases.save(seedCase({ id: oid('c-alive'), status: 'OPEN' }));
    await cases.save(seedCase({ id: oid('c-deleted'), status: 'OPEN', deletedAt: NOW }));

    const page = await cases.list({
      organizationId: ORG_1,
      limit: 10,
      offset: 0,
    });

    expect(page.total).toBe(1);
    expect(page.items.map((c) => c.id)).toEqual([oid('c-alive')]);
  });

  it('sorts by dueDate ascending with null dueDates last', async () => {
    const cases = new InMemoryCaseRepository();
    await cases.save(seedCase({ id: oid('c-null'), dueDate: null }));
    await cases.save(seedCase({ id: oid('c-late'), dueDate: LATE }));
    await cases.save(seedCase({ id: oid('c-early'), dueDate: EARLY }));
    await cases.save(seedCase({ id: oid('c-mid'), dueDate: MID }));

    const page = await cases.list({
      organizationId: ORG_1,
      limit: 10,
      offset: 0,
    });

    expect(page.items.map((c) => c.id)).toEqual([
      oid('c-early'),
      oid('c-mid'),
      oid('c-late'),
      oid('c-null'),
    ]);
  });

  it('filters by assignedToId, riskScore range, tags, and dueDate range', async () => {
    const cases = new InMemoryCaseRepository();
    const assignee = oid('analyst-2');
    await cases.save(
      seedCase({
        id: oid('c-match'),
        assignedToId: assignee,
        riskScore: 70,
        tags: ['fraud', 'wire'],
        dueDate: MID,
      }),
    );
    await cases.save(
      seedCase({
        id: oid('c-wrong-assignee'),
        assignedToId: oid('other'),
        riskScore: 70,
        tags: ['fraud', 'wire'],
        dueDate: MID,
      }),
    );
    await cases.save(
      seedCase({
        id: oid('c-low-score'),
        assignedToId: assignee,
        riskScore: 20,
        tags: ['fraud', 'wire'],
        dueDate: MID,
      }),
    );
    await cases.save(
      seedCase({
        id: oid('c-missing-tag'),
        assignedToId: assignee,
        riskScore: 70,
        tags: ['fraud'],
        dueDate: MID,
      }),
    );
    await cases.save(
      seedCase({
        id: oid('c-due-out'),
        assignedToId: assignee,
        riskScore: 70,
        tags: ['fraud', 'wire'],
        dueDate: LATE,
      }),
    );

    const page = await cases.list({
      organizationId: ORG_1,
      assignedToId: assignee,
      riskScoreMin: 50,
      riskScoreMax: 80,
      tags: ['fraud', 'wire'],
      dueAfter: EARLY,
      dueBefore: LATE,
      limit: 10,
      offset: 0,
    });

    expect(page.total).toBe(1);
    expect(page.items[0]?.id).toBe(oid('c-match'));
  });

  it('paginates with limit and offset over the filtered set', async () => {
    const cases = new InMemoryCaseRepository();
    await cases.save(seedCase({ id: oid('c-1'), dueDate: EARLY }));
    await cases.save(seedCase({ id: oid('c-2'), dueDate: MID }));
    await cases.save(seedCase({ id: oid('c-3'), dueDate: LATE }));

    const page = await cases.list({
      organizationId: ORG_1,
      limit: 1,
      offset: 1,
    });

    expect(page.total).toBe(3);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.id).toBe(oid('c-2'));
  });
});
