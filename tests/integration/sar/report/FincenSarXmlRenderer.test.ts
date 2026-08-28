import { oid } from '../../../support/oid.js';
import { renderFincenSarXml } from '../../../../src/modules/sar/infrastructure/adapters/inbound/http/report/FincenSarXmlRenderer.js';
import { SarReport } from '../../../../src/modules/sar/domain/model/aggregates/SarReport.js';
import { OrganizationSarFilingProfile } from '../../../../src/modules/sar/domain/model/aggregates/OrganizationSarFilingProfile.js';
import { generateSarReportId } from '../../../../src/modules/sar/domain/model/value-objects/SarReportId.js';
import { generateOrganizationSarFilingProfileId } from '../../../../src/modules/sar/domain/model/value-objects/OrganizationSarFilingProfileId.js';
import { createPostalAddress } from '../../../../src/modules/sar/domain/model/value-objects/PostalAddress.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-06-01T00:00:00.000Z'));
const GENERATED_AT = new Date('2026-06-02T10:30:00.000Z');
const ORG = oid('org-1');

const US_ADDRESS = createPostalAddress({
  street: '1 Market St',
  city: 'San Francisco',
  state: 'CA',
  postalCode: '94105',
  country: 'US',
});

function profile(): OrganizationSarFilingProfile {
  return OrganizationSarFilingProfile.create({
    id: generateOrganizationSarFilingProfileId(),
    organizationId: ORG,
    filerName: 'Finturu Inc.',
    filerTin: '123456789',
    filerTinType: 'EIN',
    filerAddress: US_ADDRESS,
    contactName: 'Compliance Office',
    contactPhone: '+15550100',
    contactEmail: 'compliance@example.com',
    now: NOW,
  });
}

function report(overrides: Record<string, unknown> = {}): SarReport {
  return SarReport.create({
    id: generateSarReportId(),
    organizationId: ORG,
    caseId: oid('case-1'),
    narrative: 'Structured deposits below the reporting threshold.',
    subjectName: 'Jane Doe',
    subjectAddress: US_ADDRESS,
    subjectTin: '987654321',
    subjectTinType: 'SSN_ITIN',
    subjectBirthDate: fromDate(new Date('1985-03-09T00:00:00.000Z')),
    suspiciousAmount: 42_000,
    activityStartDate: fromDate(new Date('2026-05-01T00:00:00.000Z')),
    activityEndDate: fromDate(new Date('2026-05-06T00:00:00.000Z')),
    activityCategories: ['STRUCTURING', 'MONEY_LAUNDERING'],
    createdBy: oid('an-1'),
    now: NOW,
    ...overrides,
  }).approve(oid('sup-1'), NOW);
}

function render(overrides: Record<string, unknown> = {}): string {
  return renderFincenSarXml({
    report: report(overrides),
    profile: profile(),
    generatedAt: GENERATED_AT,
  });
}

describe('renderFincenSarXml', () => {
  it('emits a batch document with the filer, contact and subject parties', () => {
    const xml = render();
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('xmlns="www.fincen.gov/base"');
    expect(xml).toContain('<RawPartyFullName>Finturu Inc.</RawPartyFullName>');
    expect(xml).toContain('<RawPartyFullName>Compliance Office</RawPartyFullName>');
    expect(xml).toContain('<RawPartyFullName>Jane Doe</RawPartyFullName>');
  });

  /* FinCEN quiere `YYYYMMDD`, sin separadores y sin hora. */
  it('formats every date as YYYYMMDD', () => {
    const xml = render();
    expect(xml).toContain('<FilingDateText>20260602</FilingDateText>');
    expect(xml).toContain('<SuspiciousActivityFromDateText>20260501</SuspiciousActivityFromDateText>');
    expect(xml).toContain('<SuspiciousActivityToDateText>20260506</SuspiciousActivityToDateText>');
    expect(xml).toContain('<IndividualBirthDateText>19850309</IndividualBirthDateText>');
  });

  it('carries one classification per category', () => {
    const xml = render();
    expect(xml).toContain('<SuspiciousActivityTypeText>STRUCTURING</SuspiciousActivityTypeText>');
    expect(xml).toContain('<SuspiciousActivityTypeText>MONEY_LAUNDERING</SuspiciousActivityTypeText>');
  });

  /*
   * La narrativa la escribe un analista a mano. Un `&` o un `<` sin escapar
   * convierte una presentacion valida en un error de parseo en el regulador.
   */
  it('escapes the five characters XML cannot carry raw', () => {
    const xml = render({
      narrative: 'Wires to "ACME & Sons" <flagged> by the bank\'s own team',
      subjectName: 'Smith & Co',
    });
    expect(xml).toContain('&amp;');
    expect(xml).toContain('&lt;flagged&gt;');
    expect(xml).toContain('&quot;ACME &amp; Sons&quot;');
    expect(xml).toContain('bank&apos;s');
    /* Y nada del texto original se cuela como marcado. */
    expect(xml).not.toContain('<flagged>');
  });

  it('rounds the suspicious amount to whole units', () => {
    expect(render({ suspiciousAmount: 1234.56 })).toContain(
      '<TotalSuspiciousAmountText>1235</TotalSuspiciousAmountText>',
    );
  });

  /* Un sujeto sin domicilio conocido no debe emitir un bloque vacio. */
  it('omits the subject address block when there is none', () => {
    const xml = render({ subjectAddress: null, subjectTin: null, subjectTinType: null });
    expect(xml.match(/<Address>/g) ?? []).toHaveLength(1);
  });

  /* Balanceo basico: cada etiqueta que abre, cierra. */
  it('closes every element it opens', () => {
    const xml = render();
    for (const tag of [
      'EFilingBatchXML',
      'Activity',
      'Parties',
      'Party',
      'SuspiciousActivity',
      'ActivityNarrativeInformation',
    ]) {
      const open = xml.match(new RegExp(`<${tag}[ >]`, 'g')) ?? [];
      const close = xml.match(new RegExp(`</${tag}>`, 'g')) ?? [];
      expect(close).toHaveLength(open.length);
    }
  });
});
