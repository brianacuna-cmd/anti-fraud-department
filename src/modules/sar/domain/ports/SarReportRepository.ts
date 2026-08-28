import type { SarReport } from '../model/aggregates/SarReport.js';
import type { SarReportId } from '../model/value-objects/SarReportId.js';
import type { Transaction } from './UnitOfWork.js';

/** Outbound port for `sar_reports`. */
export interface SarReportRepository {
  save(report: SarReport, tx?: Transaction): Promise<void>;
  findById(id: SarReportId, tx?: Transaction): Promise<SarReport | null>;
}
