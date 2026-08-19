import { createReclassifyCaseUseCase } from '../../../../src/modules/case-management/application/ReclassifyCase.js';
import { createInitializeCaseSlaService } from '../../../../src/modules/case-management/application/InitializeCaseSla.js';
import { InMemoryCaseRepository } from '../../../helpers/case-management/InMemoryCaseRepository.js';
import { InMemoryTimelineRecorder } from '../../../helpers/case-management/InMemoryTimelineRecorder.js';
import { InMemoryCaseManagementAuditRecorder } from '../../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';
import { InMemoryCaseSlaTrackingRepository } from '../../../helpers/case-management/InMemoryCaseSlaTrackingRepository.js';
import { InMemoryOrganizationFraudConfigRepository } from '../../../helpers/case-management/InMemoryOrganizationFraudConfigRepository.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/case-management/infrastructure/PassthroughUnitOfWork.js';
import { Case } from '../../../../src/modules/case-management/domain/model/aggregates/Case.js';
import { createCaseId, generateCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { createRiskScore } from '../../../../src/modules/case-management/domain/model/value-objects/RiskScore.js';
import { createCasePriority } from '../../../../src/modules/case-management/domain/model/value-objects/CasePriority.js';
import { generateCaseSlaTrackingId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseSlaTrackingId.js';
import { generateTimelineEventId } from '../../../../src/modules/case-management/domain/model/value-objects/TimelineEventId.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { CaseManagementError } from '../../../../src/modules/case-management/domain/errors/CaseManagementError.js';

const NOW = fromDate(new Date('2026-06-01T10:00:00.000Z'));
const ORG_1 = createAuthContext({ userId: 'analyst-1', organizationId: 'org-1', actorType: 'USER' });
const ORG_2 = createAuthContext({ userId: 'analyst-2', organizationId: 'org-2', actorType: 'USER' });

function build(seed: { priority?: string; tags?: string[] } = {}) {
  const cases = new InMemoryCaseRepository();
  const timelineRecorder = new InMemoryTimelineRecorder();
  const auditRecorder = new InMemoryCaseManagementAuditRecorder();
  const slaTracking = new InMemoryCaseSlaTrackingRepository();

  const kase = Case.create({
    id: generateCaseId(),
    organizationId: 'org-1',
    customerId: 'customer-1',
    riskScore: createRiskScore(50),
    priority: createCasePriority(seed.priority ?? 'LOW'),
    tags: seed.tags ?? ['AML'],
    now: NOW,
  });
  void cases.save(kase);

  const reclassifyCase = createReclassifyCaseUseCase({
    cases,
    timelineRecorder,
    unitOfWork: new PassthroughUnitOfWork(),
    clock: new FixedClock(NOW),
    generateTimelineEventId,
    auditRecorder,
    initializeCaseSla: createInitializeCaseSlaService({
      slaTracking,
      fraudConfig: new InMemoryOrganizationFraudConfigRepository(),
      generateCaseSlaTrackingId,
    }),
  });

  return { cases, timelineRecorder, auditRecorder, slaTracking, kase, reclassifyCase };
}

const eventTypes = (recorder: InMemoryTimelineRecorder) => recorder.all().map((e) => e.eventType).sort();

describe('createReclassifyCaseUseCase', () => {
  it('updates tags without touching the deadline', async () => {
    const { kase, reclassifyCase, timelineRecorder, slaTracking } = build();

    const result = await reclassifyCase({ auth: ORG_1, caseId: kase.id, tags: ['AML', 'CHARGEBACK'] });

    expect(result.tags).toEqual(['AML', 'CHARGEBACK']);
    expect(result.priority).toBe('LOW');
    expect(result.dueDate).toBeNull();
    expect(slaTracking.all()).toHaveLength(0);
    expect(eventTypes(timelineRecorder)).toEqual(['TAGS_CHANGED']);
  });

  it('recomputes the deadline when the priority changes', async () => {
    const { kase, reclassifyCase, timelineRecorder, slaTracking } = build({ priority: 'LOW' });

    const result = await reclassifyCase({ auth: ORG_1, caseId: kase.id, priority: 'CRITICAL' });

    // Ventana por defecto de CRITICAL: 30 minutos.
    expect(result.priority).toBe('CRITICAL');
    expect(result.dueDate).toBe('2026-06-01T10:30:00.000Z');
    expect(slaTracking.all()).toHaveLength(1);
    expect(slaTracking.all()[0]?.status).toBe('ON_TRACK');
    expect(eventTypes(timelineRecorder)).toEqual(['PRIORITY_CHANGED']);
  });

  it('emits one timeline entry per dimension when both change', async () => {
    const { kase, reclassifyCase, timelineRecorder } = build({ priority: 'LOW', tags: ['AML'] });

    await reclassifyCase({ auth: ORG_1, caseId: kase.id, priority: 'HIGH', tags: ['AML', 'SANCTIONS'] });

    expect(eventTypes(timelineRecorder)).toEqual(['PRIORITY_CHANGED', 'TAGS_CHANGED']);
  });

  it('writes nothing when the submitted values match what is already stored', async () => {
    const { kase, reclassifyCase, timelineRecorder, auditRecorder } = build({ priority: 'MEDIUM', tags: ['AML'] });

    const result = await reclassifyCase({ auth: ORG_1, caseId: kase.id, priority: 'MEDIUM', tags: ['AML'] });

    expect(result.priority).toBe('MEDIUM');
    expect(timelineRecorder.all()).toHaveLength(0);
    expect(auditRecorder.all()).toHaveLength(0);
  });

  it('normalizes tags: trims, drops empties, and deduplicates preserving order', async () => {
    const { kase, reclassifyCase } = build({ tags: [] });

    const result = await reclassifyCase({
      auth: ORG_1,
      caseId: kase.id,
      tags: ['  AML  ', 'AML', 'CHARGEBACK', '   ', 'AML'],
    });

    // Sin esto el filtro por etiquetas de CASE-004, que exige coincidencia
    // exacta, no encontraria el caso por ninguna de las tres variantes.
    expect(result.tags).toEqual(['AML', 'CHARGEBACK']);
  });

  it('clears every tag when given an empty array', async () => {
    const { kase, reclassifyCase } = build({ tags: ['AML', 'SANCTIONS'] });

    const result = await reclassifyCase({ auth: ORG_1, caseId: kase.id, tags: [] });

    expect(result.tags).toEqual([]);
  });

  it('records one audit row naming both the old and the new classification', async () => {
    const { kase, reclassifyCase, auditRecorder } = build({ priority: 'LOW', tags: ['AML'] });

    await reclassifyCase({ auth: ORG_1, caseId: kase.id, priority: 'HIGH', tags: ['SANCTIONS'] });

    expect(auditRecorder.all()).toHaveLength(1);
    const row = auditRecorder.all()[0];
    expect(row?.action).toBe('RECLASSIFY_CASE');
    expect(row?.detail).toMatchObject({
      previousPriority: 'LOW',
      nextPriority: 'HIGH',
      previousTags: ['AML'],
      nextTags: ['SANCTIONS'],
      dueDateRecalculated: true,
    });
  });

  it('rejects a case belonging to another tenant', async () => {
    const { kase, reclassifyCase } = build();

    await expect(reclassifyCase({ auth: ORG_2, caseId: kase.id, priority: 'HIGH' })).rejects.toThrow(
      CaseManagementError,
    );
  });

  it('rejects an unknown case', async () => {
    const { reclassifyCase } = build();

    await expect(
      reclassifyCase({ auth: ORG_1, caseId: createCaseId('64b7f1c2e4b0a1d2c3e4f5a6'), priority: 'HIGH' }),
    ).rejects.toThrow(CaseManagementError);
  });

  it('rejects an invalid priority before opening a transaction', async () => {
    const { kase, reclassifyCase, timelineRecorder } = build();

    await expect(reclassifyCase({ auth: ORG_1, caseId: kase.id, priority: 'URGENT' })).rejects.toThrow(
      CaseManagementError,
    );
    expect(timelineRecorder.all()).toHaveLength(0);
  });
});
