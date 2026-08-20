import type { CaseReport } from '../model/aggregates/CaseReport.js';
import type { CaseId } from '../model/value-objects/CaseId.js';
import type { CaseReportId } from '../model/value-objects/CaseReportId.js';
import type { Transaction } from './UnitOfWork.js';

/**
 * Outbound port for `case_reports` (append-only, immutable snapshots). `save`
 * inserts a new report; `findById` backs the detail endpoint; `listByCaseId`
 * lists a case's reports newest-first.
 */
export interface CaseReportRepository {
  save(report: CaseReport, tx?: Transaction): Promise<void>;
  findById(id: CaseReportId, tx?: Transaction): Promise<CaseReport | null>;
  listByCaseId(caseId: CaseId, tx?: Transaction): Promise<CaseReport[]>;
}
