import type { RegulatoryReport } from '../../../src/modules/regulatory/domain/model/aggregates/RegulatoryReport.js';
import type { RegulatoryReportId } from '../../../src/modules/regulatory/domain/model/value-objects/RegulatoryReportId.js';
import type {
  RegulatoryReportListQuery,
  RegulatoryReportListResult,
  RegulatoryReportRepository,
} from '../../../src/modules/regulatory/domain/ports/RegulatoryReportRepository.js';

export class InMemoryRegulatoryReportRepository implements RegulatoryReportRepository {
  private readonly rows = new Map<string, RegulatoryReport>();

  async save(report: RegulatoryReport): Promise<void> {
    this.rows.set(report.id, report);
  }

  async findById(id: RegulatoryReportId): Promise<RegulatoryReport | null> {
    return this.rows.get(id) ?? null;
  }

  async list(query: RegulatoryReportListQuery): Promise<RegulatoryReportListResult> {
    const items = [...this.rows.values()].filter(
      (r) =>
        r.organizationId === query.organizationId &&
        (query.status === undefined || query.status.length === 0 || query.status.includes(r.status)),
    );
    return { items: items.slice(query.offset, query.offset + query.limit), total: items.length };
  }

  all(): readonly RegulatoryReport[] {
    return [...this.rows.values()];
  }

  seed(report: RegulatoryReport): void {
    this.rows.set(report.id, report);
  }
}
