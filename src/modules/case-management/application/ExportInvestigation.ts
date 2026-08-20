import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { CaseRepository } from '../domain/ports/CaseRepository.js';
import type { InvestigationRepository } from '../domain/ports/InvestigationRepository.js';
import type { CaseNoteRepository } from '../domain/ports/CaseNoteRepository.js';
import type { EvidenceRepository } from '../domain/ports/EvidenceRepository.js';
import type { CaseReportRepository } from '../domain/ports/CaseReportRepository.js';
import type { UnitOfWork, Transaction } from '../domain/ports/UnitOfWork.js';
import type { CaseReportId } from '../domain/model/value-objects/CaseReportId.js';
import type { CaseId } from '../domain/model/value-objects/CaseId.js';
import type { CaseReport } from '../domain/model/aggregates/CaseReport.js';
import { CaseReport as CaseReportAggregate } from '../domain/model/aggregates/CaseReport.js';
import { createInvestigationId } from '../domain/model/value-objects/InvestigationId.js';
import { investigationNotFound, forbiddenCrossTenant } from '../domain/errors/CaseManagementError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface ExportInvestigationInput {
  readonly auth: AuthContext;
  readonly investigationId: string;
}

export interface ExportInvestigationDeps {
  readonly investigations: InvestigationRepository;
  readonly cases: CaseRepository;
  readonly notes: CaseNoteRepository;
  readonly evidence: EvidenceRepository;
  readonly reports: CaseReportRepository;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly generateCaseReportId: () => CaseReportId;
}

/**
 * GET /investigations/:id/export — consolidates the investigation's linked
 * cases (primary + linkedCaseIds) with their notes and evidence, plus the
 * findings JSON, into an executive report persisted as a `case_reports`
 * snapshot keyed on the primary case. Any authenticated tenant actor; the
 * investigation must belong to the actor's org. Scope: investigations,
 * case_reports.
 */
export function createExportInvestigationUseCase(deps: ExportInvestigationDeps) {
  return async function exportInvestigation(input: ExportInvestigationInput): Promise<CaseReport> {
    const organizationId = requireTenantContext(input.auth);
    const investigationId = createInvestigationId(input.investigationId);

    return deps.unitOfWork.withTransaction(async (tx) => {
      const investigation = await deps.investigations.findById(investigationId, tx);
      if (investigation === null) {
        throw investigationNotFound(investigationId);
      }
      if (investigation.organizationId !== organizationId) {
        throw forbiddenCrossTenant('investigation does not belong to the actor organization');
      }

      const caseIds = dedupe([investigation.caseId, ...investigation.linkedCaseIds]);
      const caseEntries: Array<Record<string, unknown>> = [];
      for (const caseId of caseIds) {
        caseEntries.push(await buildCaseEntry(caseId, deps, tx));
      }

      const now = deps.clock.now();
      const report = CaseReportAggregate.create({
        id: deps.generateCaseReportId(),
        caseId: investigation.caseId,
        organizationId,
        generatedBy: input.auth.userId,
        snapshot: {
          reportType: 'INVESTIGATION_EXPORT',
          investigationId: investigation.id,
          subjectType: investigation.subjectType,
          subjectId: investigation.subjectId,
          status: investigation.status,
          findings: investigation.findingsData,
          findingsSummary: investigation.findings,
          explorationDepth: investigation.explorationDepth,
          linkedCaseIds: [...investigation.linkedCaseIds],
          cases: caseEntries,
        },
        now,
      });
      await deps.reports.save(report, tx);
      return report;
    });
  };
}

async function buildCaseEntry(
  caseId: CaseId,
  deps: ExportInvestigationDeps,
  tx: Transaction,
): Promise<Record<string, unknown>> {
  const kase = await deps.cases.findById(caseId, tx);
  const notes = await deps.notes.listByCaseId(caseId, tx);
  const evidence = await deps.evidence.listByCaseId(caseId, tx);
  return {
    caseId,
    status: kase?.status ?? null,
    priority: kase?.priority ?? null,
    riskScore: kase?.riskScore ?? null,
    customerId: kase?.customerId ?? null,
    notes: notes.map((note) => ({
      id: note.id,
      authorId: note.authorId,
      body: note.body,
      createdAt: note.createdAt,
    })),
    evidence: evidence.map((item) => ({
      id: item.id,
      filename: item.filename,
      contentType: item.contentType,
      byteSize: item.byteSize,
      sha256: item.sha256,
    })),
  };
}

function dedupe(ids: readonly CaseId[]): CaseId[] {
  const seen = new Set<string>();
  const result: CaseId[] = [];
  for (const id of ids) {
    if (!seen.has(id as string)) {
      seen.add(id as string);
      result.push(id);
    }
  }
  return result;
}
