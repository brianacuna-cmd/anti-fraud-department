import type { SarReport } from '../../../src/modules/sar/domain/model/aggregates/SarReport.js';
import type {
  SarReportListQuery,
  SarReportListResult,
  SarReportRepository,
} from '../../../src/modules/sar/domain/ports/SarReportRepository.js';
import type { SarReportId } from '../../../src/modules/sar/domain/model/value-objects/SarReportId.js';

export class InMemorySarReportRepository implements SarReportRepository {
  private readonly byId = new Map<string, SarReport>();

  async save(report: SarReport): Promise<void> {
    this.byId.set(report.id, report);
  }

  async findById(id: SarReportId): Promise<SarReport | null> {
    return this.byId.get(id) ?? null;
  }

  async list(query: SarReportListQuery): Promise<SarReportListResult> {
    const matching = [...this.byId.values()]
      .filter((report) => report.organizationId === query.organizationId)
      .filter((report) => query.status === undefined || query.status.includes(report.status))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    return {
      items: matching.slice(query.offset, query.offset + query.limit),
      total: matching.length,
    };
  }

  all(): readonly SarReport[] {
    return [...this.byId.values()];
  }
}
