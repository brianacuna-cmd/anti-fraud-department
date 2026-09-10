import type { RegulatoryReport } from '../model/aggregates/RegulatoryReport.js';
import type { RegulatoryReportId } from '../model/value-objects/RegulatoryReportId.js';
import type { RegulatoryReportStatus } from '../model/value-objects/RegulatoryReportStatus.js';
import type { Transaction } from './UnitOfWork.js';

export interface RegulatoryReportListQuery {
  readonly organizationId: string;
  readonly status?: readonly RegulatoryReportStatus[];
  readonly limit: number;
  readonly offset: number;
}

export interface RegulatoryReportListResult {
  readonly items: readonly RegulatoryReport[];
  readonly total: number;
}

export interface RegulatoryReportRepository {
  save(report: RegulatoryReport, tx?: Transaction): Promise<void>;
  findById(id: RegulatoryReportId, tx?: Transaction): Promise<RegulatoryReport | null>;
  list(query: RegulatoryReportListQuery, tx?: Transaction): Promise<RegulatoryReportListResult>;
}
