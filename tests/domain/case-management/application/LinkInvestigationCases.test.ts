import { oid } from '../../../support/oid.js';
import { createLinkInvestigationCasesUseCase } from '../../../../src/modules/case-management/application/LinkInvestigationCases.js';
import { Case } from '../../../../src/modules/case-management/domain/model/aggregates/Case.js';
import { Investigation } from '../../../../src/modules/case-management/domain/model/aggregates/Investigation.js';
import { createCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { createInvestigationId } from '../../../../src/modules/case-management/domain/model/value-objects/InvestigationId.js';
import { createRiskScore } from '../../../../src/modules/case-management/domain/model/value-objects/RiskScore.js';
import { generateTimelineEventId } from '../../../../src/modules/case-management/domain/model/value-objects/TimelineEventId.js';
import { InMemoryCaseRepository } from '../../../helpers/case-management/InMemoryCaseRepository.js';
import { InMemoryInvestigationRepository } from '../../../helpers/case-management/InMemoryInvestigationRepository.js';
import { InMemoryTimelineRecorder } from '../../../helpers/case-management/InMemoryTimelineRecorder.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/case-management/infrastructure/PassthroughUnitOfWork.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { fromDate, type Instant } from '../../../../src/shared/time/Instant.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { CaseManagementError } from '../../../../src/modules/case-management/domain/errors/CaseManagementError.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_1 = oid('org-1');
const ORG_2 = oid('org-2');
const PRIMARY_CASE = oid('case-primary');
const INV_ID = oid('inv-1');

const ANALYST = createAuthContext({ userId: oid('an-1'), organizationId: ORG_1, actorType: 'USER', roleId: 'ANALYST' });
const OTHER = createAuthContext({ userId: oid('x'), organizationId: ORG_2, actorType: 'USER', roleId: 'ANALYST' });

function buildCase(id: string, overrides: { organizationId?: string; deletedAt?: Instant | null } = {}): Case {
  const kase = Case.create({
    id: createCaseId(id),
    organizationId: overrides.organizationId ?? ORG_1,
    customerId: `customer-${id}`,
    riskScore: createRiskScore(50),
    priority: 'MEDIUM',
    now: NOW,
  });
  if (overrides.deletedAt == null) return kase;
  return Case.rehydrate({ ...kase.toProps(), deletedAt: overrides.deletedAt });
}

function seedInvestigation(): Investigation {
  return Investigation.open({
    id: createInvestigationId(INV_ID),
    caseId: createCaseId(PRIMARY_CASE),
    organizationId: ORG_1,
    subjectType: 'WALLET',
    subjectId: 'w-1',
    openedBy: oid('an-1'),
    now: NOW,
  });
}

function build(cases: Case[] = [], investigation: Investigation | null = seedInvestigation()) {
  const caseRepo = new InMemoryCaseRepository();
  for (const c of cases) void caseRepo.save(c);
  const investigations = new InMemoryInvestigationRepository();
  if (investigation) void investigations.save(investigation);
  const timelineRecorder = new InMemoryTimelineRecorder();
  const linkInvestigationCases = createLinkInvestigationCasesUseCase({
    investigations,
    cases: caseRepo,
    timelineRecorder,
    unitOfWork: new PassthroughUnitOfWork(),
    clock: new FixedClock(NOW),
    generateTimelineEventId,
  });
  return { linkInvestigationCases, investigations, timelineRecorder };
}

describe('createLinkInvestigationCasesUseCase', () => {
  it('links existing cases and records CASE_LINKED_TO_INVESTIGATION per new case', async () => {
    const h = build([buildCase(oid('case-a')), buildCase(oid('case-b'))]);

    const result = await h.linkInvestigationCases({
      auth: ANALYST,
      investigationId: INV_ID,
      caseIds: [oid('case-a'), oid('case-b')],
    });

    expect(result.linkedCaseIds).toEqual([oid('case-a'), oid('case-b')]);
    expect(h.investigations.all()[0]?.linkedCaseIds).toHaveLength(2);
    const events = h.timelineRecorder.all();
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.eventType === 'CASE_LINKED_TO_INVESTIGATION')).toBe(true);
    expect(events[0]?.newValue).toBe(INV_ID);
  });

  it('is idempotent: re-linking an already-linked case adds nothing', async () => {
    const h = build([buildCase(oid('case-a'))]);
    await h.linkInvestigationCases({ auth: ANALYST, investigationId: INV_ID, caseIds: [oid('case-a')] });
    const second = await h.linkInvestigationCases({ auth: ANALYST, investigationId: INV_ID, caseIds: [oid('case-a')] });

    expect(second.linkedCaseIds).toHaveLength(1);
    expect(h.timelineRecorder.all()).toHaveLength(1);
  });

  it('skips the investigation primary case (no self-link)', async () => {
    const h = build([buildCase(PRIMARY_CASE)]);
    const result = await h.linkInvestigationCases({
      auth: ANALYST,
      investigationId: INV_ID,
      caseIds: [PRIMARY_CASE],
    });
    expect(result.linkedCaseIds).toHaveLength(0);
    expect(h.timelineRecorder.all()).toHaveLength(0);
  });

  it('throws CASE_NOT_FOUND when a case is missing (all-or-nothing)', async () => {
    const h = build([buildCase(oid('case-a'))]);
    await expect(
      h.linkInvestigationCases({ auth: ANALYST, investigationId: INV_ID, caseIds: [oid('case-a'), oid('missing')] }),
    ).rejects.toMatchObject({ code: 'CASE_NOT_FOUND' } satisfies Partial<CaseManagementError>);
    expect(h.investigations.all()[0]?.linkedCaseIds).toHaveLength(0);
    expect(h.timelineRecorder.all()).toHaveLength(0);
  });

  it('rejects linking a case from another tenant', async () => {
    const h = build([buildCase(oid('case-foreign'), { organizationId: ORG_2 })]);
    await expect(
      h.linkInvestigationCases({ auth: ANALYST, investigationId: INV_ID, caseIds: [oid('case-foreign')] }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_CROSS_TENANT' });
  });

  it('rejects a soft-deleted case with CASE_NOT_FOUND', async () => {
    const h = build([buildCase(oid('case-del'), { deletedAt: NOW })]);
    await expect(
      h.linkInvestigationCases({ auth: ANALYST, investigationId: INV_ID, caseIds: [oid('case-del')] }),
    ).rejects.toMatchObject({ code: 'CASE_NOT_FOUND' });
  });

  it('throws INVESTIGATION_NOT_FOUND when the investigation is missing', async () => {
    const h = build([buildCase(oid('case-a'))], null);
    await expect(
      h.linkInvestigationCases({ auth: ANALYST, investigationId: INV_ID, caseIds: [oid('case-a')] }),
    ).rejects.toMatchObject({ code: 'INVESTIGATION_NOT_FOUND' });
  });

  it('rejects a cross-tenant actor with FORBIDDEN_CROSS_TENANT', async () => {
    const h = build([buildCase(oid('case-a'))]);
    await expect(
      h.linkInvestigationCases({ auth: OTHER, investigationId: INV_ID, caseIds: [oid('case-a')] }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_CROSS_TENANT' });
  });
});
