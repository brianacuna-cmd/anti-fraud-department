import { oid } from '../../../support/oid.js';
import { createExportInvestigationUseCase } from '../../../../src/modules/case-management/application/ExportInvestigation.js';
import { createExportInvestigationSummaryUseCase } from '../../../../src/modules/case-management/application/ExportInvestigationSummary.js';
import { createBuildEntityNetworkGraphUseCase } from '../../../../src/modules/case-management/application/BuildEntityNetworkGraph.js';
import { Case } from '../../../../src/modules/case-management/domain/model/aggregates/Case.js';
import { CaseNote } from '../../../../src/modules/case-management/domain/model/aggregates/CaseNote.js';
import { Investigation } from '../../../../src/modules/case-management/domain/model/aggregates/Investigation.js';
import { createCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { createCaseNoteId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseNoteId.js';
import { createInvestigationId } from '../../../../src/modules/case-management/domain/model/value-objects/InvestigationId.js';
import { generateCaseReportId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseReportId.js';
import { createRiskScore } from '../../../../src/modules/case-management/domain/model/value-objects/RiskScore.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/case-management/infrastructure/PassthroughUnitOfWork.js';
import { InMemoryCaseRepository } from '../../../helpers/case-management/InMemoryCaseRepository.js';
import { InMemoryInvestigationRepository } from '../../../helpers/case-management/InMemoryInvestigationRepository.js';
import { InMemoryAnalystDecisionRepository } from '../../../helpers/case-management/InMemoryAnalystDecisionRepository.js';
import { InMemoryEnforcementActionRepository } from '../../../helpers/case-management/InMemoryEnforcementActionRepository.js';
import { InMemoryCaseNoteRepository } from '../../../helpers/case-management/InMemoryCaseNoteRepository.js';
import { InMemoryEvidenceRepository } from '../../../helpers/case-management/InMemoryEvidenceRepository.js';
import { InMemoryCaseReportRepository } from '../../../helpers/case-management/InMemoryCaseReportRepository.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { CaseManagementError } from '../../../../src/modules/case-management/domain/errors/CaseManagementError.js';

const NOW = fromDate(new Date('2026-02-01T00:00:00.000Z'));
const ORG_1 = oid('exp-org-1');
const ORG_2 = oid('exp-org-2');
const INV_ID = createInvestigationId(oid('exp-inv-1'));
const ANALYST_ID = oid('exp-analyst-1');
const ROOT_WALLET = '0xexport';

const ANALYST = createAuthContext({
  userId: ANALYST_ID,
  organizationId: ORG_1,
  actorType: 'USER',
  roleId: 'ANALYST',
});

let seq = 0;
function buildCase(overrides: { bridgeWallet?: string | null; riskScore?: number }): Case {
  seq += 1;
  return Case.create({
    id: createCaseId(oid(`case-exp-${seq}`)),
    organizationId: ORG_1,
    customerId: `customer-exp-${seq}`,
    customerEmail: null,
    bridgeWallet: overrides.bridgeWallet ?? null,
    riskScore: createRiskScore(overrides.riskScore ?? 50),
    priority: 'HIGH',
    now: NOW,
  });
}

function setup() {
  const cases = new InMemoryCaseRepository();
  const investigations = new InMemoryInvestigationRepository();
  const decisions = new InMemoryAnalystDecisionRepository();
  const enforcementActions = new InMemoryEnforcementActionRepository();
  const notes = new InMemoryCaseNoteRepository();
  const evidence = new InMemoryEvidenceRepository();
  const reports = new InMemoryCaseReportRepository();

  const exportInvestigation = createExportInvestigationUseCase({
    exportInvestigationSummary: createExportInvestigationSummaryUseCase({
      cases,
      investigations,
      decisions,
      enforcementActions,
      notes,
      evidence,
      buildEntityNetworkGraph: createBuildEntityNetworkGraphUseCase({ cases, investigations }),
      clock: new FixedClock(NOW),
    }),
    reports,
    unitOfWork: new PassthroughUnitOfWork(),
    clock: new FixedClock(NOW),
    generateCaseReportId,
  });

  return { cases, investigations, notes, reports, exportInvestigation };
}

async function seedInvestigation(
  investigations: InMemoryInvestigationRepository,
  caseId = createCaseId(oid('case-exp-root')),
  organizationId = ORG_1,
) {
  await investigations.save(
    Investigation.open({
      id: INV_ID,
      caseId,
      organizationId,
      subjectType: 'WALLET',
      subjectId: ROOT_WALLET,
      openedBy: ANALYST_ID,
      now: NOW,
    }),
  );
}

describe('ExportInvestigation (INV-014, congelado)', () => {
  it('404 cuando la investigación no existe', async () => {
    const { exportInvestigation } = setup();

    await expect(exportInvestigation({ auth: ANALYST, investigationId: INV_ID })).rejects.toThrow(
      CaseManagementError,
    );
  });

  it('403 cuando es de otro inquilino, y no deja informe escrito', async () => {
    const { investigations, reports, exportInvestigation } = setup();
    await seedInvestigation(investigations, createCaseId(oid('case-exp-root')), ORG_2);

    await expect(exportInvestigation({ auth: ANALYST, investigationId: INV_ID })).rejects.toThrow(
      /does not belong/,
    );
    expect(reports.all()).toHaveLength(0);
  });

  it('persiste el informe en case_reports colgado del expediente raíz', async () => {
    const { cases, investigations, reports, exportInvestigation } = setup();

    const root = buildCase({ bridgeWallet: ROOT_WALLET, riskScore: 88 });
    await cases.save(root);
    await seedInvestigation(investigations, root.id);

    const report = await exportInvestigation({ auth: ANALYST, investigationId: INV_ID });

    expect(reports.all()).toHaveLength(1);
    expect(report.caseId).toBe(root.id);
    expect(report.organizationId).toBe(ORG_1);
    expect(report.generatedBy).toBe(ANALYST_ID);
    expect(report.createdAt).toBe(NOW);

    const snapshot = report.snapshot as Record<string, unknown>;
    expect(snapshot['reportType']).toBe('INVESTIGATION_EXPORT');
    expect((snapshot['investigation'] as { id: string }).id).toBe(INV_ID);
    expect((snapshot['totals'] as { totalCases: number }).totalCases).toBe(1);
  });

  /** What separates an export from a view: the document carries the evidence. */
  it('el congelado incluye las notas de cada expediente', async () => {
    const { cases, investigations, notes, exportInvestigation } = setup();

    const root = buildCase({ bridgeWallet: ROOT_WALLET });
    await cases.save(root);
    await seedInvestigation(investigations, root.id);
    await notes.save(
      CaseNote.create({
        id: createCaseNoteId(oid('exp-note-1')),
        caseId: root.id,
        organizationId: ORG_1,
        authorId: ANALYST_ID,
        body: 'tres transferencias en cadena la misma noche',
        now: NOW,
      }),
    );

    const report = await exportInvestigation({ auth: ANALYST, investigationId: INV_ID });
    const snapshot = report.snapshot as Record<string, unknown>;
    const [first] = snapshot['cases'] as { notes: { body: string }[] }[];

    expect(first!.notes[0]!.body).toBe('tres transferencias en cadena la misma noche');
  });

  /**
   * Each call leaves a new report on purpose: the history of what was
   * delivered and when is exactly what makes the delivery auditable.
   */
  it('dos exportaciones dejan dos informes, no uno pisado', async () => {
    const { cases, investigations, reports, exportInvestigation } = setup();

    const root = buildCase({ bridgeWallet: ROOT_WALLET });
    await cases.save(root);
    await seedInvestigation(investigations, root.id);

    const first = await exportInvestigation({ auth: ANALYST, investigationId: INV_ID });
    const second = await exportInvestigation({ auth: ANALYST, investigationId: INV_ID });

    expect(reports.all()).toHaveLength(2);
    expect(first.id).not.toBe(second.id);
  });
});
