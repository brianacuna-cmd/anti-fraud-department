import type { Instant } from '../../../../shared/time/Instant.js';
import { toDate } from '../../../../shared/time/Instant.js';
import type { SarReport } from '../model/aggregates/SarReport.js';
import type { OrganizationSarFilingProfile } from '../model/aggregates/OrganizationSarFilingProfile.js';

/**
 * One thing that stops the report from being filed, named by the field it
 * belongs to.
 *
 * `field` uses the dotted path of the FILING document (`filer.tin`,
 * `subject.address.state`), not the aggregate's property name, because the
 * person reading it is filling in a filing, not browsing our schema.
 */
export interface FilingDefect {
  readonly field: string;
  readonly reason: string;
}

/**
 * Field limits the filing schema imposes.
 *
 * Collected here, and nowhere else, so that verifying them against the
 * official specification is reading one block rather than auditing a
 * validator. The narrative ceiling is the load-bearing one: FinCEN's SAR
 * narrative is capped at 17,000 characters, and a report that exceeds it is
 * rejected AFTER submission, once the filing window has already been used.
 */
export const FILING_LIMITS = {
  narrative: 17_000,
  filerName: 150,
  subjectName: 150,
  street: 100,
  city: 50,
  postalCode: 9,
  contactName: 150,
  contactPhone: 16,
} as const;

/**
 * Everything that would make the generated file bounce, in one pass.
 *
 * Deliberately returns a LIST instead of throwing on the first problem: a
 * compliance officer completing a report needs to see all of it at once. A
 * validator that reports one missing field per attempt turns a five-minute
 * form into five round trips.
 *
 * An empty list means the file can be built — it does not mean the filing
 * will be accepted. Nothing here checks that the narrative actually
 * describes the activity, and no validator can.
 */
export function assessFilingReadiness(
  report: SarReport,
  profile: OrganizationSarFilingProfile | null,
  now: Instant,
): readonly FilingDefect[] {
  return [
    ...assessFiler(profile),
    ...assessReport(report, now),
    ...assessSubject(report),
  ];
}

function assessFiler(profile: OrganizationSarFilingProfile | null): FilingDefect[] {
  if (profile === null) {
    return [
      {
        field: 'filer',
        reason:
          'the organization has no filing profile: set the legal name, TIN and address before generating a report file',
      },
    ];
  }
  const defects: FilingDefect[] = [];
  pushTooLong(defects, 'filer.name', profile.filerName, FILING_LIMITS.filerName);
  pushTooLong(defects, 'filer.contactName', profile.contactName, FILING_LIMITS.contactName);
  pushTooLong(defects, 'filer.contactPhone', profile.contactPhone, FILING_LIMITS.contactPhone);
  pushAddressDefects(defects, 'filer.address', profile.filerAddress);
  return defects;
}

function assessReport(report: SarReport, now: Instant): FilingDefect[] {
  const defects: FilingDefect[] = [];

  /*
   * A draft is not a filing. Locking is what makes the content defensible,
   * and generating a file from an editable report means the XML and the
   * record can drift apart with nobody noticing.
   */
  if (report.status !== 'APPROVED') {
    defects.push({
      field: 'report.status',
      reason: 'only an APPROVED report can be filed: review and approve it first',
    });
  }

  pushTooLong(defects, 'report.narrative', report.narrative, FILING_LIMITS.narrative);

  if (report.activityCategories.length === 0) {
    defects.push({
      field: 'activity.categories',
      reason: 'pick at least one suspicious activity category',
    });
  }

  if (report.suspiciousAmount === null) {
    defects.push({ field: 'activity.amount', reason: 'the suspicious amount is required' });
  }

  if (report.activityStartDate === null) {
    defects.push({
      field: 'activity.startDate',
      reason: 'the date the suspicious activity started is required',
    });
  }

  defects.push(...assessActivityWindow(report, now));
  return defects;
}

/**
 * The window has to be a window: it cannot end before it began, and it
 * cannot run into the future. Both are the kind of typo that survives review
 * and is caught by the regulator instead.
 */
function assessActivityWindow(report: SarReport, now: Instant): FilingDefect[] {
  const start = report.activityStartDate;
  const end = report.activityEndDate;
  const defects: FilingDefect[] = [];

  if (start !== null && toDate(start).getTime() > toDate(now).getTime()) {
    defects.push({ field: 'activity.startDate', reason: 'the start date is in the future' });
  }
  if (end !== null && toDate(end).getTime() > toDate(now).getTime()) {
    defects.push({ field: 'activity.endDate', reason: 'the end date is in the future' });
  }
  if (start !== null && end !== null && toDate(end).getTime() < toDate(start).getTime()) {
    defects.push({ field: 'activity.endDate', reason: 'the end date is before the start date' });
  }
  return defects;
}

/**
 * The subject block.
 *
 * A genuinely unidentified counterparty is a normal reason to file, so this
 * does NOT demand a real identity — it demands that the filer say so. Write
 * `UNKNOWN` where the value is unknown; what is refused is silence, because
 * a blank element and an unknown subject are indistinguishable in the file.
 */
function assessSubject(report: SarReport): FilingDefect[] {
  const defects: FilingDefect[] = [];

  if (report.subjectName === null || report.subjectName.trim().length === 0) {
    defects.push({
      field: 'subject.name',
      reason: 'the subject name is required — use UNKNOWN if the subject was never identified',
    });
  }
  pushTooLong(defects, 'subject.name', report.subjectName ?? '', FILING_LIMITS.subjectName);

  if (report.subjectAddress === null) {
    defects.push({
      field: 'subject.address',
      reason: 'the subject address is required — use UNKNOWN in the street and city if it is not known',
    });
  }
  if (report.subjectAddress !== null) {
    pushAddressDefects(defects, 'subject.address', report.subjectAddress);
  }
  if (report.subjectTin !== null && report.subjectTinType === null) {
    defects.push({
      field: 'subject.tinType',
      reason: 'a subject TIN needs its type (EIN, SSN_ITIN, FOREIGN or UNKNOWN)',
    });
  }
  return defects;
}

function pushAddressDefects(
  defects: FilingDefect[],
  prefix: string,
  address: { street: string; city: string; postalCode: string },
): void {
  pushTooLong(defects, `${prefix}.street`, address.street, FILING_LIMITS.street);
  pushTooLong(defects, `${prefix}.city`, address.city, FILING_LIMITS.city);
  pushTooLong(defects, `${prefix}.postalCode`, address.postalCode, FILING_LIMITS.postalCode);
}

function pushTooLong(defects: FilingDefect[], field: string, value: string, max: number): void {
  if (value.length > max) {
    defects.push({
      field,
      reason: `exceeds the ${max}-character limit (${value.length} characters)`,
    });
  }
}
