import type { SarReport } from '../model/aggregates/SarReport.js';
import type { SarReportId } from '../model/value-objects/SarReportId.js';
import type { SarReportStatus } from '../model/value-objects/SarReportStatus.js';
import type { Transaction } from './UnitOfWork.js';

export interface SarReportListQuery {
  readonly organizationId: string;
  readonly status?: readonly SarReportStatus[];
  readonly limit: number;
  readonly offset: number;
}

export interface SarReportListResult {
  readonly items: readonly SarReport[];
  readonly total: number;
}

/** Outbound port for `sar_reports`. */
export interface SarReportRepository {
  save(report: SarReport, tx?: Transaction): Promise<void>;
  findById(id: SarReportId, tx?: Transaction): Promise<SarReport | null>;
  /** SAR-005 (list screen): tenant-scoped, paginated, filterable by status. */
  list(query: SarReportListQuery, tx?: Transaction): Promise<SarReportListResult>;
}
