import type { CaseReport } from '../../../src/modules/case-management/domain/model/aggregates/CaseReport.js';
import type { CaseReportRepository } from '../../../src/modules/case-management/domain/ports/CaseReportRepository.js';
import type { CaseId } from '../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import type { CaseReportId } from '../../../src/modules/case-management/domain/model/value-objects/CaseReportId.js';

/** In-memory `CaseReportRepository` fake — append-only, newest-first list. */
export class InMemoryCaseReportRepository implements CaseReportRepository {
  private readonly reports: CaseReport[] = [];

  async save(report: CaseReport): Promise<void> {
    this.reports.push(report);
  }

  async findById(id: CaseReportId): Promise<CaseReport | null> {
    return this.reports.find((report) => (report.id as string) === (id as string)) ?? null;
  }

  async listByCaseId(caseId: CaseId): Promise<CaseReport[]> {
    return this.reports.filter((report) => (report.caseId as string) === (caseId as string)).reverse();
  }

  /** Test-only: every stored report, insertion order. */
  all(): readonly CaseReport[] {
    return [...this.reports];
  }
}
