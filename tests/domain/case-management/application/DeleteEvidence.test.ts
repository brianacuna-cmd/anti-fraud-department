import { oid } from '../../../support/oid.js';
import { createDeleteEvidenceUseCase } from '../../../../src/modules/case-management/application/DeleteEvidence.js';
import { Evidence } from '../../../../src/modules/case-management/domain/model/aggregates/Evidence.js';
import { createEvidenceId } from '../../../../src/modules/case-management/domain/model/value-objects/EvidenceId.js';
import { createCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { generateTimelineEventId } from '../../../../src/modules/case-management/domain/model/value-objects/TimelineEventId.js';
import { InMemoryEvidenceRepository } from '../../../helpers/case-management/InMemoryEvidenceRepository.js';
import { InMemoryTimelineRecorder } from '../../../helpers/case-management/InMemoryTimelineRecorder.js';
import { InMemoryCaseManagementAuditRecorder } from '../../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/case-management/infrastructure/PassthroughUnitOfWork.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { CaseManagementError } from '../../../../src/modules/case-management/domain/errors/CaseManagementError.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_1 = oid('org-1');
const ORG_2 = oid('org-2');
const EV_ID = oid('ev-1');
const CASE_ID = oid('case-1');

const SUPERVISOR = createAuthContext({ userId: oid('sup-1'), organizationId: ORG_1, actorType: 'USER', roleId: 'SUPERVISOR' });
const ANALYST = createAuthContext({ userId: oid('an-1'), organizationId: ORG_1, actorType: 'USER', roleId: 'ANALYST' });

function buildEvidence(organizationId = ORG_1): Evidence {
  return Evidence.register({
    id: createEvidenceId(EV_ID),
    caseId: createCaseId(CASE_ID),
    investigationId: null,
    organizationId,
    filename: 'proof.pdf',
    contentType: 'application/pdf',
    byteSize: 1024,
    sha256: 'a'.repeat(64),
    storageKey: 'k/1',
    timestamp: null,
    uploadedBy: oid('an-1'),
    now: NOW,
  });
}

function build(seed?: Evidence) {
  const evidence = new InMemoryEvidenceRepository();
  if (seed) void evidence.save(seed);
  const timelineRecorder = new InMemoryTimelineRecorder();
  const auditRecorder = new InMemoryCaseManagementAuditRecorder();
  const deleteEvidence = createDeleteEvidenceUseCase({
    evidence,
    timelineRecorder,
    auditRecorder,
    unitOfWork: new PassthroughUnitOfWork(),
    clock: new FixedClock(NOW),
    generateTimelineEventId,
  });
  return { deleteEvidence, evidence, timelineRecorder, auditRecorder };
}

describe('createDeleteEvidenceUseCase', () => {
  it('soft-deletes evidence and records EVIDENCE_DELETED + DELETE_EVIDENCE', async () => {
    const h = build(buildEvidence());

    const result = await h.deleteEvidence({ auth: SUPERVISOR, evidenceId: EV_ID });

    expect(result.deletedAt).toEqual(NOW);
    expect((await h.evidence.findById(createEvidenceId(EV_ID)))?.deletedAt).toEqual(NOW);
    expect(h.timelineRecorder.all()[0]?.eventType).toBe('EVIDENCE_DELETED');
    expect(h.auditRecorder.all()[0]?.action).toBe('DELETE_EVIDENCE');
  });

  it('hides soft-deleted evidence from listByCaseId', async () => {
    const h = build(buildEvidence());
    await h.deleteEvidence({ auth: SUPERVISOR, evidenceId: EV_ID });
    expect(await h.evidence.listByCaseId(createCaseId(CASE_ID))).toHaveLength(0);
  });

  it('is idempotent: re-deleting is a no-op (no extra timeline/audit)', async () => {
    const h = build(buildEvidence());
    await h.deleteEvidence({ auth: SUPERVISOR, evidenceId: EV_ID });
    await h.deleteEvidence({ auth: SUPERVISOR, evidenceId: EV_ID });
    expect(h.timelineRecorder.all()).toHaveLength(1);
    expect(h.auditRecorder.all()).toHaveLength(1);
  });

  it('rejects ANALYST with FORBIDDEN_ROLE', async () => {
    const h = build(buildEvidence());
    await expect(h.deleteEvidence({ auth: ANALYST, evidenceId: EV_ID })).rejects.toMatchObject({
      code: 'FORBIDDEN_ROLE',
    } satisfies Partial<CaseManagementError>);
  });

  it('throws EVIDENCE_NOT_FOUND when missing', async () => {
    const h = build();
    await expect(h.deleteEvidence({ auth: SUPERVISOR, evidenceId: oid('missing') })).rejects.toMatchObject({
      code: 'EVIDENCE_NOT_FOUND',
    });
  });

  it('rejects cross-tenant with FORBIDDEN_CROSS_TENANT', async () => {
    const h = build(buildEvidence(ORG_2));
    await expect(h.deleteEvidence({ auth: SUPERVISOR, evidenceId: EV_ID })).rejects.toMatchObject({
      code: 'FORBIDDEN_CROSS_TENANT',
    });
  });
});
