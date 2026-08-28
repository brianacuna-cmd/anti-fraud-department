import { toDate } from '../../../../../../../shared/time/Instant.js';
import type { SarReport } from '../../../../../domain/model/aggregates/SarReport.js';
import type { OrganizationSarFilingProfile } from '../../../../../domain/model/aggregates/OrganizationSarFilingProfile.js';
import type { PostalAddress } from '../../../../../domain/model/value-objects/PostalAddress.js';

/**
 * Renders an approved report as a FinCEN BSA E-Filing batch document.
 *
 * Lives in the HTTP adapter for the same reason `CaseReportPdfRenderer`
 * does: it is a response format, not a rule. Everything that decides whether
 * the report MAY be filed is in `SarFilingReadiness`, and this renderer
 * assumes that check already passed — it formats, it does not judge.
 *
 * ------------------------------------------------------------------------
 * BEFORE FILING FOR REAL, verify `PARTY_TYPE` and the element names below
 * against the official FinCEN XSD for the schema version in force. The
 * structure here follows the published batch shape, but the numeric party
 * codes and element spellings are the part that changes between schema
 * revisions, and a wrong code is accepted by a well-formedness check and
 * rejected by the filing system. They are gathered in one block precisely so
 * that verification is reading a table, not auditing a renderer.
 * ------------------------------------------------------------------------
 */
const PARTY_TYPE = {
  transmitter: '35',
  transmitterContact: '37',
  reportingInstitution: '30',
  contactOffice: '8',
  subject: '33',
} as const;

const FINCEN_NAMESPACE = 'www.fincen.gov/base';

/** FinCEN dates are `YYYYMMDD`, with no separators and no time. */
function filingDate(value: Date): string {
  const year = value.getUTCFullYear().toString().padStart(4, '0');
  const month = (value.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = value.getUTCDate().toString().padStart(2, '0');
  return `${year}${month}${day}`;
}

/**
 * The five characters XML cannot carry raw.
 *
 * Not optional politeness: a narrative is free text written by an analyst,
 * and an `&` or a `<` in it turns a valid filing into a parse error at the
 * regulator's end.
 */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function element(name: string, value: string | null, indent: string): string {
  if (value === null || value.length === 0) return '';
  return `${indent}<${name}>${escapeXml(value)}</${name}>\n`;
}

function addressBlock(address: PostalAddress, indent: string): string {
  return (
    `${indent}<Address>\n` +
    element('RawStreetAddress1Text', address.street, `${indent}  `) +
    element('RawCityText', address.city, `${indent}  `) +
    element('RawStateCodeText', address.state, `${indent}  `) +
    element('RawZIPCode', address.postalCode, `${indent}  `) +
    element('RawCountryCodeText', address.country, `${indent}  `) +
    `${indent}</Address>\n`
  );
}

function partyName(name: string, indent: string): string {
  return (
    `${indent}<PartyName>\n` +
    element('RawPartyFullName', name, `${indent}  `) +
    `${indent}</PartyName>\n`
  );
}

function identification(number: string, typeCode: string, indent: string): string {
  return (
    `${indent}<PartyIdentification>\n` +
    element('PartyIdentificationNumberText', number, `${indent}  `) +
    element('PartyIdentificationTypeCode', typeCode, `${indent}  `) +
    `${indent}</PartyIdentification>\n`
  );
}

/** Domain TIN types mapped onto the filing schema's identification codes. */
const TIN_TYPE_CODE: Readonly<Record<string, string>> = {
  EIN: '2',
  SSN_ITIN: '1',
  FOREIGN: '9',
  UNKNOWN: '999',
};

export interface RenderFincenSarXmlInput {
  readonly report: SarReport;
  readonly profile: OrganizationSarFilingProfile;
  readonly generatedAt: Date;
}

export function renderFincenSarXml(input: RenderFincenSarXmlInput): string {
  const { report, profile } = input;

  const filerParty =
    `      <Party>\n` +
    element('ActivityPartyTypeCode', PARTY_TYPE.reportingInstitution, '        ') +
    partyName(profile.filerName, '        ') +
    addressBlock(profile.filerAddress, '        ') +
    identification(profile.filerTin, TIN_TYPE_CODE[profile.filerTinType] ?? '999', '        ') +
    `      </Party>\n`;

  const contactParty =
    `      <Party>\n` +
    element('ActivityPartyTypeCode', PARTY_TYPE.contactOffice, '        ') +
    partyName(profile.contactName, '        ') +
    element('PartyContactPhoneNumberText', profile.contactPhone, '        ') +
    element('PartyContactEmailAddressText', profile.contactEmail, '        ') +
    `      </Party>\n`;

  const subjectParty =
    `      <Party>\n` +
    element('ActivityPartyTypeCode', PARTY_TYPE.subject, '        ') +
    partyName(report.subjectName ?? 'UNKNOWN', '        ') +
    (report.subjectAddress ? addressBlock(report.subjectAddress, '        ') : '') +
    (report.subjectTin
      ? identification(report.subjectTin, TIN_TYPE_CODE[report.subjectTinType ?? 'UNKNOWN'] ?? '999', '        ')
      : '') +
    (report.subjectBirthDate
      ? element('IndividualBirthDateText', filingDate(toDate(report.subjectBirthDate)), '        ')
      : '') +
    `      </Party>\n`;

  const classifications = report.activityCategories
    .map(
      (category) =>
        `        <SuspiciousActivityClassification>\n` +
        element('SuspiciousActivityTypeText', category, '          ') +
        `        </SuspiciousActivityClassification>\n`,
    )
    .join('');

  const suspiciousActivity =
    `      <SuspiciousActivity>\n` +
    (report.activityStartDate
      ? element(
          'SuspiciousActivityFromDateText',
          filingDate(toDate(report.activityStartDate)),
          '        ',
        )
      : '') +
    (report.activityEndDate
      ? element(
          'SuspiciousActivityToDateText',
          filingDate(toDate(report.activityEndDate)),
          '        ',
        )
      : '') +
    (report.suspiciousAmount !== null
      ? element('TotalSuspiciousAmountText', String(Math.round(report.suspiciousAmount)), '        ')
      : '') +
    classifications +
    `      </SuspiciousActivity>\n`;

  const narrative =
    `      <ActivityNarrativeInformation>\n` +
    element('ActivityNarrativeSequenceNumber', '1', '        ') +
    element('ActivityNarrativeText', report.narrative, '        ') +
    `      </ActivityNarrativeInformation>\n`;

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<EFilingBatchXML xmlns="${FINCEN_NAMESPACE}" FormTypeCode="SARX">\n` +
    `  <FormTypeCode>SARX</FormTypeCode>\n` +
    `  <Activity>\n` +
    element('FilingDateText', filingDate(input.generatedAt), '    ') +
    `    <ActivityAssociation>\n` +
    element('InitialReportIndicator', 'Y', '      ') +
    `    </ActivityAssociation>\n` +
    `    <Parties>\n` +
    filerParty +
    contactParty +
    subjectParty +
    `    </Parties>\n` +
    suspiciousActivity +
    narrative +
    `  </Activity>\n` +
    `</EFilingBatchXML>\n`
  );
}
