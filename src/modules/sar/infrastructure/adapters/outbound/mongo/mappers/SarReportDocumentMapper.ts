import { ObjectId } from 'mongodb';
import { fromDate, toDate } from '../../../../../../../shared/time/Instant.js';
import { SarReport } from '../../../../../domain/model/aggregates/SarReport.js';
import { createSarReportId } from '../../../../../domain/model/value-objects/SarReportId.js';
import { createSarReportStatus } from '../../../../../domain/model/value-objects/SarReportStatus.js';
import { createSuspiciousActivityCategory } from '../../../../../domain/model/value-objects/SuspiciousActivityCategory.js';
import { createTinType } from '../../../../../domain/model/value-objects/TinType.js';
import { createPostalAddress, type PostalAddress } from '../../../../../domain/model/value-objects/PostalAddress.js';
import type { PostalAddressDocument, SarReportDocument } from '../documents/SarReportDocument.js';

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
    subjectAddress: document.subject_address ? toAddress(document.subject_address) : null,
    subjectTin: document.subject_tin,
    subjectTinType: document.subject_tin_type ? createTinType(document.subject_tin_type) : null,
    subjectBirthDate: document.subject_birth_date ? fromDate(document.subject_birth_date) : null,
    /*
     * Documents written before filing detail existed have no
     * `activity_categories` key. Defaulting to `[]` keeps them readable
     * instead of throwing on every old draft.
     */
    activityCategories: (document.activity_categories ?? []).map(createSuspiciousActivityCategory),
    suspiciousAmount: document.suspicious_amount,
    activityStartDate: document.activity_start_date ? fromDate(document.activity_start_date) : null,
    activityEndDate: document.activity_end_date ? fromDate(document.activity_end_date) : null,
    createdBy: document.created_by,
    approvedBy: document.approved_by,
    approvedAt: document.approved_at ? fromDate(document.approved_at) : null,
    /* Documents written before SAR-004 have no filing keys — `?? null`
     * keeps every report already on disk readable. */
    bsaIdentifier: document.bsa_identifier ?? null,
    filedAt: document.filed_at ? fromDate(document.filed_at) : null,
    filedBy: document.filed_by ?? null,
    acknowledgementReference: document.acknowledgement_reference ?? null,
    filingRejectionReason: document.filing_rejection_reason ?? null,
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
    subject_address: report.subjectAddress ? toAddressDocument(report.subjectAddress) : null,
    subject_tin: report.subjectTin,
    subject_tin_type: report.subjectTinType,
    subject_birth_date: report.subjectBirthDate ? toDate(report.subjectBirthDate) : null,
    activity_categories: [...report.activityCategories],
    suspicious_amount: report.suspiciousAmount,
    activity_start_date: report.activityStartDate ? toDate(report.activityStartDate) : null,
    activity_end_date: report.activityEndDate ? toDate(report.activityEndDate) : null,
    created_by: report.createdBy,
    approved_by: report.approvedBy,
    approved_at: report.approvedAt ? toDate(report.approvedAt) : null,
    bsa_identifier: report.bsaIdentifier,
    filed_at: report.filedAt ? toDate(report.filedAt) : null,
    filed_by: report.filedBy,
    acknowledgement_reference: report.acknowledgementReference,
    filing_rejection_reason: report.filingRejectionReason,
    created_at: toDate(report.createdAt),
    updated_at: toDate(report.updatedAt),
  };
}

function toAddress(document: PostalAddressDocument): PostalAddress {
  return createPostalAddress({
    street: document.street,
    city: document.city,
    state: document.state,
    postalCode: document.postal_code,
    country: document.country,
  });
}

function toAddressDocument(address: PostalAddress): PostalAddressDocument {
  return {
    street: address.street,
    city: address.city,
    state: address.state,
    postal_code: address.postalCode,
    country: address.country,
  };
}
