import { ObjectId } from 'mongodb';
import { fromDate, toDate } from '../../../../../../../shared/time/Instant.js';
import { SarReport } from '../../../../../domain/model/aggregates/SarReport.js';
import { createSarReportId } from '../../../../../domain/model/value-objects/SarReportId.js';
import { createSarReportStatus } from '../../../../../domain/model/value-objects/SarReportStatus.js';
import type { SarReportDocument } from '../documents/SarReportDocument.js';

/** snake_case (Mongo) -> camelCase (domain). Instant fields are BSON `Date`. */
export function toDomain(document: SarReportDocument): SarReport {
  return SarReport.rehydrate({
    id: createSarReportId(document._id.toString()),
    organizationId: document.organization_id.toString(),
    caseId: document.case_id,
    amlAlertId: document.aml_alert_id,
    status: createSarReportStatus(document.status),
    narrative: document.narrative,
    subjectName: document.subject_name,
    suspiciousAmount: document.suspicious_amount,
    activityStartDate: document.activity_start_date ? fromDate(document.activity_start_date) : null,
    activityEndDate: document.activity_end_date ? fromDate(document.activity_end_date) : null,
    createdBy: document.created_by,
    createdAt: fromDate(document.created_at),
    updatedAt: fromDate(document.updated_at),
  });
}

/** camelCase (domain) -> snake_case (Mongo). */
export function toDocument(report: SarReport): SarReportDocument {
  return {
    _id: new ObjectId(report.id),
    organization_id: new ObjectId(report.organizationId),
    case_id: report.caseId,
    aml_alert_id: report.amlAlertId,
    status: report.status,
    narrative: report.narrative,
    subject_name: report.subjectName,
    suspicious_amount: report.suspiciousAmount,
    activity_start_date: report.activityStartDate ? toDate(report.activityStartDate) : null,
    activity_end_date: report.activityEndDate ? toDate(report.activityEndDate) : null,
    created_by: report.createdBy,
    created_at: toDate(report.createdAt),
    updated_at: toDate(report.updatedAt),
  };
}
