import { toDate } from '../../../../../../../shared/time/Instant.js';
import type { SarReport } from '../../../../../domain/model/aggregates/SarReport.js';
import type { OrganizationSarFilingProfile } from '../../../../../domain/model/aggregates/OrganizationSarFilingProfile.js';
import type { PostalAddress } from '../../../../../domain/model/value-objects/PostalAddress.js';

export interface SarReportResponseDto {
  readonly id: string;
  readonly organizationId: string;
  readonly caseId: string | null;
  readonly amlAlertId: string | null;
  readonly status: string;
  readonly narrative: string;
  readonly subjectName: string | null;
  readonly subjectAddress: PostalAddress | null;
  readonly subjectTin: string | null;
  readonly subjectTinType: string | null;
  readonly subjectBirthDate: string | null;
  readonly activityCategories: readonly string[];
  readonly suspiciousAmount: number | null;
  readonly activityStartDate: string | null;
  readonly activityEndDate: string | null;
  readonly createdBy: string;
  readonly approvedBy: string | null;
  readonly approvedAt: string | null;
  readonly bsaIdentifier: string | null;
  readonly filedAt: string | null;
  readonly filedBy: string | null;
  readonly acknowledgementReference: string | null;
  readonly filingRejectionReason: string | null;
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
    subjectAddress: report.subjectAddress,
    subjectTin: report.subjectTin,
    subjectTinType: report.subjectTinType,
    subjectBirthDate: report.subjectBirthDate ? toDate(report.subjectBirthDate).toISOString() : null,
    activityCategories: [...report.activityCategories],
    suspiciousAmount: report.suspiciousAmount,
    activityStartDate: report.activityStartDate ? toDate(report.activityStartDate).toISOString() : null,
    activityEndDate: report.activityEndDate ? toDate(report.activityEndDate).toISOString() : null,
    createdBy: report.createdBy,
    approvedBy: report.approvedBy,
    approvedAt: report.approvedAt ? toDate(report.approvedAt).toISOString() : null,
    bsaIdentifier: report.bsaIdentifier,
    filedAt: report.filedAt ? toDate(report.filedAt).toISOString() : null,
    filedBy: report.filedBy,
    acknowledgementReference: report.acknowledgementReference,
    filingRejectionReason: report.filingRejectionReason,
    createdAt: toDate(report.createdAt).toISOString(),
    updatedAt: toDate(report.updatedAt).toISOString(),
  };
}

export interface SarFilingProfileResponseDto {
  readonly id: string;
  readonly organizationId: string;
  readonly filerName: string;
  readonly filerTin: string;
  readonly filerTinType: string;
  readonly filerAddress: PostalAddress;
  readonly contactName: string;
  readonly contactPhone: string;
  readonly contactEmail: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Domain → HTTP DTO for the tenant's filing identity. */
export function toSarFilingProfileResponse(
  profile: OrganizationSarFilingProfile,
): SarFilingProfileResponseDto {
  return {
    id: profile.id,
    organizationId: profile.organizationId,
    filerName: profile.filerName,
    filerTin: profile.filerTin,
    filerTinType: profile.filerTinType,
    filerAddress: profile.filerAddress,
    contactName: profile.contactName,
    contactPhone: profile.contactPhone,
    contactEmail: profile.contactEmail,
    createdAt: toDate(profile.createdAt).toISOString(),
    updatedAt: toDate(profile.updatedAt).toISOString(),
  };
}
