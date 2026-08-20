import type { CaseReport } from '../../../../../domain/model/aggregates/CaseReport.js';

export interface CaseReportDto {
  readonly id: string;
  readonly caseId: string;
  readonly generatedBy: string;
  readonly createdAt: string;
  readonly snapshot: Readonly<Record<string, unknown>>;
}

export function toCaseReportResponse(report: CaseReport): CaseReportDto {
  return {
    id: report.id,
    caseId: report.caseId,
    generatedBy: report.generatedBy,
    createdAt: report.createdAt,
    snapshot: report.snapshot,
  };
}
