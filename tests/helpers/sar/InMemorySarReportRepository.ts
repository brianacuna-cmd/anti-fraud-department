import type { SarReport } from '../../../src/modules/sar/domain/model/aggregates/SarReport.js';
import type { SarReportRepository } from '../../../src/modules/sar/domain/ports/SarReportRepository.js';
import type { SarReportId } from '../../../src/modules/sar/domain/model/value-objects/SarReportId.js';

export class InMemorySarReportRepository implements SarReportRepository {
  private readonly byId = new Map<string, SarReport>();

  async save(report: SarReport): Promise<void> {
    this.byId.set(report.id, report);
  }

  async findById(id: SarReportId): Promise<SarReport | null> {
    return this.byId.get(id) ?? null;
  }

  all(): readonly SarReport[] {
    return [...this.byId.values()];
  }
}
