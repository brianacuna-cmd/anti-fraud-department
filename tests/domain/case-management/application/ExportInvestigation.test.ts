import { oid } from '../../../support/oid.js';
import { createExportInvestigationUseCase } from '../../../../src/modules/case-management/application/ExportInvestigation.js';
import { Investigation } from '../../../../src/modules/case-management/domain/model/aggregates/Investigation.js';
import { Case } from '../../../../src/modules/case-management/domain/model/aggregates/Case.js';
import { CaseNote } from '../../../../src/modules/case-management/domain/model/aggregates/CaseNote.js';
import { Evidence } from '../../../../src/modules/case-management/domain/model/aggregates/Evidence.js';
import { createInvestigationId } from '../../../../src/modules/case-management/domain/model/value-objects/InvestigationId.js';
import { createCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { createCaseNoteId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseNoteId.js';
import { createEvidenceId } from '../../../../src/modules/case-management/domain/model/value-objects/EvidenceId.js';
import { createRiskScore } from '../../../../src/modules/case-management/domain/model/value-objects/RiskScore.js';
import { generateCaseReportId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseReportId.js';
import { InMemoryInvestigationRepository } from '../../../helpers/case-management/InMemoryInvestigationRepository.js';
import { InMemoryCaseRepository } from '../../../helpers/case-management/InMemoryCaseRepository.js';
import { InMemoryCaseNoteRepository } from '../../../helpers/case-management/InMemoryCaseNoteRepository.js';
import { InMemoryEvidenceRepository } from '../../../helpers/case-management/InMemoryEvidenceRepository.js';
import { InMemoryCaseReportRepository } from '../../../helpers/case-management/InMemoryCaseReportRepository.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/case-management/infrastructure/PassthroughUnitOfWork.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_1 = oid('org-1');
const ORG_2 = oid('org-2');
const INV_ID = oid('inv-1');
const CASE_A = oid('case-a');
const CASE_B = oid('case-b');

const ANALYST = createAuthContext({ userId: oid('an-1'), organizationId: ORG_1, actorType: 'USER', roleId: 'ANALYST' });

function buildCase(id: string): Case {
  return Case.create({
    id: createCaseId(id),
    organizationId: ORG_1,
    customerId: `customer-${id}`,
    riskScore: createRiskScore(60),
    priority: 'HIGH',
    now: NOW,
  });
}

function buildInvestigation(organizationId = ORG_1): Investigation {
  return Investigation.open({
    id: createInvestigationId(INV_ID),
    caseId: createCaseId(CASE_A),
    organizationId,
    subjectType: 'WALLET',
    subjectId: 'w-1',
    openedBy: oid('an-1'),
    now: NOW,
  })
    .linkCases([createCaseId(CASE_B)], NOW)
    .recordFindings({ ring: 'A', nodes: 7 }, 3, NOW);
}

function build(investigation: Investigation | null = buildInvestigation()) {
  const investigations = new InMemoryInvestigationRepository();
  if (investigation) void investigations.save(investigation);
  const cases = new InMemoryCaseRepository();
  void cases.save(buildCase(CASE_A));
  void cases.save(buildCase(CASE_B));
  const notes = new InMemoryCaseNoteRepository();
  void notes.save(
    CaseNote.create({ id: createCaseNoteId(oid('note-1')), caseId: createCaseId(CASE_A), organizationId: ORG_1, authorId: oid('an-1'), body: 'suspicious pattern', now: NOW }),
  );
  const evidence = new InMemoryEvidenceRepository();
  void evidence.save(
    Evidence.register({
      id: createEvidenceId(oid('ev-1')),
      caseId: createCaseId(CASE_B),
      investigationId: null,
      organizationId: ORG_1,
      filename: 'proof.pdf',
      contentType: 'application/pdf',
      byteSize: 1024,
      sha256: 'a'.repeat(64),
      storageKey: 'k/1',
      timestamp: null,
      uploadedBy: oid('an-1'),
      now: NOW,
    }),
  );
  const reports = new InMemoryCaseReportRepository();
  const exportInvestigation = createExportInvestigationUseCase({
    investigations,
    cases,
    notes,
    evidence,
    reports,
    unitOfWork: new PassthroughUnitOfWork(),
    clock: new FixedClock(NOW),
    generateCaseReportId,
  });
  return { exportInvestigation, reports };
}

describe('createExportInvestigationUseCase', () => {
  it('consolidates linked cases + notes + evidence + findings into a persisted case_reports snapshot', async () => {
    const h = build();

    const report = await h.exportInvestigation({ auth: ANALYST, investigationId: INV_ID });

    // persisted to case_reports keyed on the primary case
    expect(report.caseId).toBe(CASE_A);
    expect(h.reports.all()).toHaveLength(1);

    const snapshot = report.snapshot as Record<string, unknown>;
    expect(snapshot.investigationId).toBe(INV_ID);
    expect(snapshot.findings).toEqual({ ring: 'A', nodes: 7 });
    expect(snapshot.explorationDepth).toBe(3);
    expect(snapshot.linkedCaseIds).toEqual([CASE_B]);

    const cases = snapshot.cases as Array<Record<string, unknown>>;
    expect(cases.map((c) => c.caseId)).toEqual([CASE_A, CASE_B]);
    const caseA = cases.find((c) => c.caseId === CASE_A)!;
    expect((caseA.notes as unknown[]).length).toBe(1);
    const caseB = cases.find((c) => c.caseId === CASE_B)!;
    expect((caseB.evidence as unknown[]).length).toBe(1);
  });

  it('throws INVESTIGATION_NOT_FOUND when missing', async () => {
    const h = build(null);
    await expect(
      h.exportInvestigation({ auth: ANALYST, investigationId: INV_ID }),
    ).rejects.toMatchObject({ code: 'INVESTIGATION_NOT_FOUND' });
  });

  it('rejects a cross-tenant actor with FORBIDDEN_CROSS_TENANT', async () => {
    const h = build(buildInvestigation(ORG_2));
    await expect(
      h.exportInvestigation({ auth: ANALYST, investigationId: INV_ID }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_CROSS_TENANT' });
  });
});
