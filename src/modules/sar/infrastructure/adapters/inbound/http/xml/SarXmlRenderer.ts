import { toDate } from '../../../../../../../shared/time/Instant.js';
import { assertReadyForFiling } from '../../../../../domain/services/assertReadyForFiling.js';
import type { SarReport } from '../../../../../domain/model/aggregates/SarReport.js';

/**
 * SAR-003. Compiles a locked (`APPROVED`) SAR report into this app's own
 * filing XML representation ("AMLR 4.0" — an internal schema name, not a
 * real FinCEN standard: no official FinCEN BSA E-Filing XSD is available to
 * this project, so there is nothing authentic to validate against). Built
 * by hand, no XML library — same "dependency-free default" precedent as
 * `JsonCaseExportRenderer`. `assertReadyForFiling` plays the role an XSD
 * would: it is what rejects an incomplete document before one is produced.
 */
export class SarXmlRenderer {
  readonly contentType = 'application/xml';

  render(report: SarReport): Buffer {
    assertReadyForFiling(report);

    // `assertReadyForFiling` guarantees status === 'APPROVED', and `approve()`
    // always sets `approvedBy`/`approvedAt`/`subjectName`/`suspiciousAmount`/
    // `activityStartDate` together with it, so the non-null casts below are
    // safe — the gate above is what makes them safe.
    const approvedBy = report.approvedBy as string;
    const approvedAt = report.approvedAt as NonNullable<typeof report.approvedAt>;
    const subjectName = report.subjectName as string;
    const activityStartDate = report.activityStartDate as NonNullable<typeof report.activityStartDate>;

    const sourceReference =
      report.caseId !== null
        ? `    <CaseId>${escapeXml(report.caseId)}</CaseId>`
        : `    <AmlAlertId>${escapeXml(report.amlAlertId as string)}</AmlAlertId>`;

    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<SARFiling xmlns="urn:aftd:sar:amlr-4.0" schemaVersion="AMLR-4.0">',
      '  <FilingHeader>',
      `    <ReportId>${escapeXml(report.id)}</ReportId>`,
      `    <OrganizationId>${escapeXml(report.organizationId)}</OrganizationId>`,
      `    <Status>${escapeXml(report.status)}</Status>`,
      `    <ApprovedBy>${escapeXml(approvedBy)}</ApprovedBy>`,
      `    <ApprovedAt>${toDate(approvedAt).toISOString()}</ApprovedAt>`,
      `    <GeneratedAt>${new Date().toISOString()}</GeneratedAt>`,
      '  </FilingHeader>',
      '  <SourceReference>',
      sourceReference,
      '  </SourceReference>',
      '  <SubjectInformation>',
      `    <SubjectName>${escapeXml(subjectName)}</SubjectName>`,
      '  </SubjectInformation>',
      '  <SuspiciousActivity>',
      `    <Narrative>${escapeXml(report.narrative)}</Narrative>`,
      `    <SuspiciousAmount>${String(report.suspiciousAmount)}</SuspiciousAmount>`,
      `    <ActivityStartDate>${toDate(activityStartDate).toISOString()}</ActivityStartDate>`,
      report.activityEndDate !== null
        ? `    <ActivityEndDate>${toDate(report.activityEndDate).toISOString()}</ActivityEndDate>`
        : '    <ActivityEndDate/>',
      '  </SuspiciousActivity>',
      '</SARFiling>',
      '',
    ].join('\n');

    return Buffer.from(xml, 'utf-8');
  }
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
