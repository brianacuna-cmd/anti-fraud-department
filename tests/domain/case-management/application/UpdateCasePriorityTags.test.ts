import { oid } from '../../../support/oid.js';
import { createUpdateCasePriorityTagsUseCase } from '../../../../src/modules/case-management/application/UpdateCasePriorityTags.js';
import { Case } from '../../../../src/modules/case-management/domain/model/aggregates/Case.js';
import { CaseSlaTracking } from '../../../../src/modules/case-management/domain/model/aggregates/CaseSlaTracking.js';
import { OrganizationFraudConfig } from '../../../../src/modules/case-management/domain/model/aggregates/OrganizationFraudConfig.js';
import { createCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { createRiskScore } from '../../../../src/modules/case-management/domain/model/value-objects/RiskScore.js';
import { generateTimelineEventId } from '../../../../src/modules/case-management/domain/model/value-objects/TimelineEventId.js';
import { generateCaseSlaTrackingId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseSlaTrackingId.js';
import { generateOrganizationFraudConfigId } from '../../../../src/modules/case-management/domain/model/value-objects/OrganizationFraudConfigId.js';
import { InMemoryCaseRepository } from '../../../helpers/case-management/InMemoryCaseRepository.js';
import { InMemoryTimelineRecorder } from '../../../helpers/case-management/InMemoryTimelineRecorder.js';
import { InMemoryCaseManagementAuditRecorder } from '../../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';
import { InMemoryCaseSlaTrackingRepository } from '../../../helpers/case-management/InMemoryCaseSlaTrackingRepository.js';
import { InMemoryOrganizationFraudConfigRepository } from '../../../helpers/case-management/InMemoryOrganizationFraudConfigRepository.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/case-management/infrastructure/PassthroughUnitOfWork.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { fromDate, toDate } from '../../../../src/shared/time/Instant.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { CaseManagementError } from '../../../../src/modules/case-management/domain/errors/CaseManagementError.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const OLD_DUE = fromDate(new Date('2025-12-01T00:00:00.000Z'));
const ORG_1 = oid('org-1');
const CASE_ID = createCaseId(oid('case-tags-1'));
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

// HIGH SLA is 60 minutes in the seeded config.
const EXPECTED_HIGH_DUE = fromDate(new Date(toDate(NOW).getTime() + 60 * 60_000));

function buildCase(overrides: { deletedAt?: typeof NOW | null } = {}): Case {
  const open = Case.create({
    id: CASE_ID,
    organizationId: ORG_1,
    customerId: 'customer-1',
    riskScore: createRiskScore(50),
    priority: 'MEDIUM',
    tags: ['fraud'],
    now: NOW,
  }).withDueDate(OLD_DUE, NOW);

  if (overrides.deletedAt == null) {
    return open;
  }

  return Case.rehydrate({ ...open.toProps(), deletedAt: overrides.deletedAt });
}

function seedFraudConfig(repo: InMemoryOrganizationFraudConfigRepository): void {
  repo.seed(
    OrganizationFraudConfig.create({
      id: generateOrganizationFraudConfigId(),
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
      now: NOW,
    }),
  );
}

function buildUseCase(seed?: Case, withSla = true) {
  const cases = new InMemoryCaseRepository();
  if (seed !== undefined) {
    void cases.save(seed);
  }
  const timelineRecorder = new InMemoryTimelineRecorder();
  const auditRecorder = new InMemoryCaseManagementAuditRecorder();
  const slaTracking = new InMemoryCaseSlaTrackingRepository();
  const fraudConfig = new InMemoryOrganizationFraudConfigRepository();
  seedFraudConfig(fraudConfig);

  if (seed !== undefined && withSla) {
    void slaTracking.save(
      CaseSlaTracking.create({
        id: generateCaseSlaTrackingId(),
        caseId: seed.id,
        dueDate: OLD_DUE,
        now: NOW,
      }),
    );
  }

  const updateCasePriorityTags = createUpdateCasePriorityTagsUseCase({
    cases,
    slaTracking,
    fraudConfig,
    timelineRecorder,
    auditRecorder,
    unitOfWork: new PassthroughUnitOfWork(),
    clock: new FixedClock(NOW),
    generateTimelineEventId,
    generateCaseSlaTrackingId,
  });

  return { updateCasePriorityTags, cases, timelineRecorder, auditRecorder, slaTracking };
}

describe('createUpdateCasePriorityTagsUseCase', () => {
  it('updates tags + priority, recalculates SLA, records PRIORITY_CHANGED + TAGS_UPDATED + audit', async () => {
    const { updateCasePriorityTags, cases, timelineRecorder, auditRecorder, slaTracking } =
      buildUseCase(buildCase());

    const result = await updateCasePriorityTags({
      auth: ANALYST,
      caseId: CASE_ID,
      priority: 'HIGH',
      tags: ['chargeback', 'aml'],
    });

    expect(result.priority).toBe('HIGH');
    expect(result.tags).toEqual(['chargeback', 'aml']);
    expect(result.dueDate).toEqual(EXPECTED_HIGH_DUE);
    expect(cases.all()[0]?.priority).toBe('HIGH');
    expect(cases.all()[0]?.dueDate).toEqual(EXPECTED_HIGH_DUE);

    const tracking = slaTracking.all()[0];
    expect(tracking?.status).toBe('ON_TRACK');
    expect(tracking?.dueDate).toEqual(EXPECTED_HIGH_DUE);

    const events = timelineRecorder.all();
    expect(events.map((e) => e.eventType)).toEqual(
      expect.arrayContaining(['PRIORITY_CHANGED', 'TAGS_UPDATED']),
    );
    const priorityEvent = events.find((e) => e.eventType === 'PRIORITY_CHANGED');
    expect(priorityEvent?.previousValue).toBe('MEDIUM');
    expect(priorityEvent?.newValue).toBe('HIGH');

    const audits = auditRecorder.all();
    expect(audits).toHaveLength(1);
    expect(audits[0]?.action).toBe('UPDATE_PRIORITY_TAGS');
    expect(audits[0]?.detail).toMatchObject({
      previousPriority: 'MEDIUM',
      newPriority: 'HIGH',
      priorityChanged: true,
      newTags: ['chargeback', 'aml'],
    });
  });

  it('leaves SLA/dueDate untouched when only tags change', async () => {
    const { updateCasePriorityTags, timelineRecorder } = buildUseCase(buildCase());

    const result = await updateCasePriorityTags({
      auth: ANALYST,
      caseId: CASE_ID,
      priority: 'MEDIUM',
      tags: ['fraud', 'reviewed'],
    });

    expect(result.priority).toBe('MEDIUM');
    expect(result.dueDate).toEqual(OLD_DUE);
    const events = timelineRecorder.all();
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe('TAGS_UPDATED');
  });

  it('trims and de-duplicates tags', async () => {
    const { updateCasePriorityTags } = buildUseCase(buildCase());

    const result = await updateCasePriorityTags({
      auth: ANALYST,
      caseId: CASE_ID,
      priority: 'MEDIUM',
      tags: ['  aml  ', 'aml', 'kyc'],
    });

    expect(result.tags).toEqual(['aml', 'kyc']);
  });

  it('creates SLA tracking when none exists yet and priority changes', async () => {
    const { updateCasePriorityTags, slaTracking } = buildUseCase(buildCase(), false);

    const result = await updateCasePriorityTags({
      auth: ANALYST,
      caseId: CASE_ID,
      priority: 'HIGH',
      tags: ['fraud'],
    });

    expect(result.dueDate).toEqual(EXPECTED_HIGH_DUE);
    expect(slaTracking.all()).toHaveLength(1);
    expect(slaTracking.all()[0]?.dueDate).toEqual(EXPECTED_HIGH_DUE);
  });

  it('rejects a no-op (no priority or tags change) with INVARIANT_VIOLATION', async () => {
    const { updateCasePriorityTags, timelineRecorder, auditRecorder } = buildUseCase(buildCase());

    await expect(
      updateCasePriorityTags({
        auth: ANALYST,
        caseId: CASE_ID,
        priority: 'MEDIUM',
        tags: ['fraud'],
      }),
    ).rejects.toMatchObject({ code: 'INVARIANT_VIOLATION' } satisfies Partial<CaseManagementError>);

    expect(timelineRecorder.all()).toHaveLength(0);
    expect(auditRecorder.all()).toHaveLength(0);
  });

  it('rejects AUDITOR with FORBIDDEN_ROLE', async () => {
    const { updateCasePriorityTags } = buildUseCase(buildCase());

    await expect(
      updateCasePriorityTags({
        auth: AUDITOR,
        caseId: CASE_ID,
        priority: 'HIGH',
        tags: ['fraud'],
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_ROLE' });
  });

  it('returns CASE_NOT_FOUND when the case is soft-deleted', async () => {
    const { updateCasePriorityTags } = buildUseCase(buildCase({ deletedAt: NOW }));

    await expect(
      updateCasePriorityTags({
        auth: ANALYST,
        caseId: CASE_ID,
        priority: 'HIGH',
        tags: ['fraud'],
      }),
    ).rejects.toMatchObject({ code: 'CASE_NOT_FOUND' });
  });
});
