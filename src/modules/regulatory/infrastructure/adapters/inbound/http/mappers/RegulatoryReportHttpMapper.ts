import type { RegulatoryReport } from '../../../../../domain/model/aggregates/RegulatoryReport.js';

export interface RegulatoryReportResponse {
  readonly id: string;
  readonly organizationId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly status: string;
  readonly figures: {
    readonly casesOpened: number;
    readonly casesResolved: number;
    readonly fraudConfirmed: number;
    readonly falsePositives: number;
    readonly slaBreached: number;
    readonly enforcementExecuted: number;
    readonly enforcementReverted: number;
    readonly sarsFiled: number;
    readonly suspiciousAmountDeclared: number | null;
    readonly blockedAmount: null;
  };
  readonly generatedBy: string;
  readonly generatedAt: string;
  readonly issuedBy: string | null;
  readonly issuedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function toRegulatoryReportResponse(report: RegulatoryReport): RegulatoryReportResponse {
  return {
    id: report.id,
    organizationId: report.organizationId,
    periodStart: report.periodStart,
    periodEnd: report.periodEnd,
    status: report.status,
    figures: { ...report.figures },
    generatedBy: report.generatedBy,
    generatedAt: report.generatedAt,
    issuedBy: report.issuedBy,
    issuedAt: report.issuedAt,
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
  };
}
