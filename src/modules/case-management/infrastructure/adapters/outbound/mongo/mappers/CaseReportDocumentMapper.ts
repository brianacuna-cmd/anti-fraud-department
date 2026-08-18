import { ObjectId } from 'mongodb';
import { fromDate, toDate } from '../../../../../../../shared/time/Instant.js';
import { CaseReport } from '../../../../../domain/model/aggregates/CaseReport.js';
import { createCaseReportId } from '../../../../../domain/model/value-objects/CaseReportId.js';
import { createCaseId } from '../../../../../domain/model/value-objects/CaseId.js';
import type { CaseReportDocument } from '../documents/CaseReportDocument.js';

/** camelCase (domain) -> snake_case (Mongo). Snapshot is stored as an embedded object. */
export function toDocument(report: CaseReport): CaseReportDocument {
  return {
    _id: new ObjectId(report.id),
    case_id: new ObjectId(report.caseId),
    organization_id: new ObjectId(report.organizationId),
    generated_by: report.generatedBy,
    snapshot: report.snapshot,
    created_at: toDate(report.createdAt),
  };
}

/** snake_case (Mongo) -> camelCase (domain). */
export function toDomain(document: CaseReportDocument): CaseReport {
  return CaseReport.rehydrate({
    id: createCaseReportId(document._id.toString()),
    caseId: createCaseId(document.case_id.toString()),
    organizationId: document.organization_id.toString(),
    generatedBy: document.generated_by,
    snapshot: document.snapshot,
    createdAt: fromDate(document.created_at),
  });
}
