import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { CaseReportRepository } from '../domain/ports/CaseReportRepository.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import type { CaseReportId } from '../domain/model/value-objects/CaseReportId.js';
import type { CaseReport } from '../domain/model/aggregates/CaseReport.js';
import { CaseReport as CaseReportAggregate } from '../domain/model/aggregates/CaseReport.js';
import { createCaseId } from '../domain/model/value-objects/CaseId.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import type { createExportInvestigationSummaryUseCase } from './ExportInvestigationSummary.js';

export interface ExportInvestigationInput {
  readonly auth: AuthContext;
  readonly investigationId: string;
  readonly maxDepth?: number;
}

export interface ExportInvestigationDeps {
  readonly exportInvestigationSummary: ReturnType<typeof createExportInvestigationSummaryUseCase>;
  readonly reports: CaseReportRepository;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly generateCaseReportId: () => CaseReportId;
}

/**
 * INV-014 — freezes the executive report of an investigation.
 *
 * GET /investigations/:investigationId/export
 *
 * It is the same report `/summary` returns, with notes and evidence for each
 * case, written to `case_reports` with `reportType: 'INVESTIGATION_EXPORT'`
 * and attached to the investigation's root case.
 *
 * WHY TWO ROUTES AND NOT ONE
 *
 * `/summary` answers "how the network looks now" and is therefore not
 * saved: an open investigation changes with every case that comes in, and
 * a frozen copy of that only produces reports that age in silence.
 *
 * An export is the opposite. It is delivered to someone — a committee, a
 * regulator, a court — and that someone has to be able to open, months
 * later, exactly what they were given. If the document is recalculated
 * when opened, sender and recipient end up reading different things under
 * the same identifier, with no way to know which one counted. Freezing it
 * is what turns it into a delivery instead of a link.
 *
 * WHY THE READ STAYS OUTSIDE THE TRANSACTION
 *
 * The transaction wraps only the report write. Composing it walks the
 * entire network — up to `MAX_GRAPH_NODES` cases, with their notes,
 * evidence, analyst decisions, and enforcement actions — and keeping a
 * transaction open for that walk would lock the working set far longer
 * than needed to insert one row. Nothing that is read is modified here,
 * so the only thing lost is consistent read: the report may mix two
 * instants milliseconds apart. For an executive snapshot that is
 * acceptable; `generatedAt` records when it was taken.
 */
export function createExportInvestigationUseCase(deps: ExportInvestigationDeps) {
  return async function exportInvestigation(
    input: ExportInvestigationInput,
  ): Promise<CaseReport> {
    // Validates tenant, existence, and ownership; if anything fails, it
    // blows up before any transaction is opened.
    const summary = await deps.exportInvestigationSummary({
      auth: input.auth,
      investigationId: input.investigationId,
      includeCaseDetail: true,
      ...(input.maxDepth === undefined ? {} : { maxDepth: input.maxDepth }),
    });

    const report = CaseReportAggregate.create({
      id: deps.generateCaseReportId(),
      caseId: createCaseId(summary.investigation.caseId),
      organizationId: requireTenantContext(input.auth),
      generatedBy: input.auth.userId,
      snapshot: {
        reportType: 'INVESTIGATION_EXPORT',
        investigation: summary.investigation,
        network: summary.network,
        totals: summary.totals,
        cases: summary.cases,
        generatedAt: summary.generatedAt,
      },
      now: deps.clock.now(),
    });

    await deps.unitOfWork.withTransaction(async (tx) => {
      await deps.reports.save(report, tx);
    });
    return report;
  };
}
