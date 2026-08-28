import { toDate } from '../../../../../../../shared/time/Instant.js';
import type { SarReport } from '../../../../../domain/model/aggregates/SarReport.js';

export interface SarReportResponseDto {
  readonly id: string;
  readonly organizationId: string;
  readonly caseId: string | null;
  readonly amlAlertId: string | null;
  readonly status: string;
  readonly narrative: string;
  readonly subjectName: string | null;
  readonly suspiciousAmount: number | null;
  readonly activityStartDate: string | null;
  readonly activityEndDate: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Domain → HTTP DTO for a SAR report. */
export function toSarReportResponse(report: SarReport): SarReportResponseDto {
  return {
    id: report.id,
    organizationId: report.organizationId,
    caseId: report.caseId,
    amlAlertId: report.amlAlertId,
    status: report.status,
    narrative: report.narrative,
    subjectName: report.subjectName,
    suspiciousAmount: report.suspiciousAmount,
    activityStartDate: report.activityStartDate ? toDate(report.activityStartDate).toISOString() : null,
    activityEndDate: report.activityEndDate ? toDate(report.activityEndDate).toISOString() : null,
    createdBy: report.createdBy,
    createdAt: toDate(report.createdAt).toISOString(),
    updatedAt: toDate(report.updatedAt).toISOString(),
  };
}
