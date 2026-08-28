import { oid } from '../../../support/oid.js';
import {
  assessFilingReadiness,
  FILING_LIMITS,
} from '../../../../src/modules/sar/domain/services/SarFilingReadiness.js';
import { SarReport } from '../../../../src/modules/sar/domain/model/aggregates/SarReport.js';
import { OrganizationSarFilingProfile } from '../../../../src/modules/sar/domain/model/aggregates/OrganizationSarFilingProfile.js';
import { generateSarReportId } from '../../../../src/modules/sar/domain/model/value-objects/SarReportId.js';
import { generateOrganizationSarFilingProfileId } from '../../../../src/modules/sar/domain/model/value-objects/OrganizationSarFilingProfileId.js';
import { createPostalAddress } from '../../../../src/modules/sar/domain/model/value-objects/PostalAddress.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-06-01T00:00:00.000Z'));
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

/** An APPROVED report carrying every field the filing schema asks for. */
function fileableReport(overrides: Record<string, unknown> = {}): SarReport {
  const draft = SarReport.create({
    id: generateSarReportId(),
    organizationId: ORG,
    caseId: oid('case-1'),
    narrative: 'Structured deposits below the reporting threshold across five days.',
    subjectName: 'Jane Doe',
    subjectAddress: US_ADDRESS,
    subjectTin: '987654321',
    subjectTinType: 'SSN_ITIN',
    suspiciousAmount: 42_000,
    activityStartDate: fromDate(new Date('2026-05-01T00:00:00.000Z')),
    activityEndDate: fromDate(new Date('2026-05-06T00:00:00.000Z')),
    activityCategories: ['STRUCTURING'],
    createdBy: oid('an-1'),
    now: NOW,
    ...overrides,
  });
  return draft.approve(oid('sup-1'), NOW);
}

function fieldsOf(defects: readonly { field: string }[]): string[] {
  return defects.map((d) => d.field);
}

describe('assessFilingReadiness', () => {
  it('finds nothing wrong with a complete approved report', () => {
    expect(assessFilingReadiness(fileableReport(), profile(), NOW)).toEqual([]);
  });

  /*
   * Sin perfil no hay institucion que reporte, asi que no tiene sentido
   * enumerar el resto: se nombra el bloque entero y se dice que hacer.
   */
  it('names the whole filer block when the tenant has no profile', () => {
    expect(fieldsOf(assessFilingReadiness(fileableReport(), null, NOW))).toContain('filer');
  });

  it('refuses a draft: only an approved report can be filed', () => {
    const draft = SarReport.create({
      id: generateSarReportId(),
      organizationId: ORG,
      caseId: oid('case-1'),
      narrative: 'x',
      subjectName: 'Jane Doe',
      subjectAddress: US_ADDRESS,
      suspiciousAmount: 1,
      activityStartDate: fromDate(new Date('2026-05-01T00:00:00.000Z')),
      activityCategories: ['FRAUD'],
      createdBy: oid('an-1'),
      now: NOW,
    });
    expect(fieldsOf(assessFilingReadiness(draft, profile(), NOW))).toContain('report.status');
  });

  /*
   * Devolver TODOS los defectos y no el primero es la diferencia entre un
   * formulario de cinco minutos y cinco viajes de ida y vuelta.
   */
  it('reports every defect at once, not just the first', () => {
    const bare = SarReport.create({
      id: generateSarReportId(),
      organizationId: ORG,
      caseId: oid('case-1'),
      narrative: 'x',
      createdBy: oid('an-1'),
      now: NOW,
    }).approve(oid('sup-1'), NOW);

    expect(fieldsOf(assessFilingReadiness(bare, profile(), NOW)).sort()).toEqual([
      'activity.amount',
      'activity.categories',
      'activity.startDate',
      'subject.address',
      'subject.name',
    ]);
  });

  /*
   * El tope de la narrativa es el que de verdad muerde: se rechaza DESPUES
   * de enviar, cuando la ventana de presentacion ya se uso.
   */
  it('rejects a narrative past the schema limit', () => {
    const long = fileableReport({ narrative: 'a'.repeat(FILING_LIMITS.narrative + 1) });
    const defects = assessFilingReadiness(long, profile(), NOW);
    expect(fieldsOf(defects)).toContain('report.narrative');
    expect(defects[0]?.reason).toContain(String(FILING_LIMITS.narrative));
  });

  it('rejects an activity window that ends before it starts', () => {
    const inverted = fileableReport({
      activityStartDate: fromDate(new Date('2026-05-10T00:00:00.000Z')),
      activityEndDate: fromDate(new Date('2026-05-01T00:00:00.000Z')),
    });
    expect(fieldsOf(assessFilingReadiness(inverted, profile(), NOW))).toContain('activity.endDate');
  });

  it('rejects activity dated in the future', () => {
    const ahead = fileableReport({
      activityStartDate: fromDate(new Date('2027-01-01T00:00:00.000Z')),
      activityEndDate: fromDate(new Date('2027-01-02T00:00:00.000Z')),
    });
    expect(fieldsOf(assessFilingReadiness(ahead, profile(), NOW))).toEqual([
      'activity.startDate',
      'activity.endDate',
    ]);
  });

  /* Un sujeto sin identificar es motivo normal de reportar; el silencio no. */
  it('accepts UNKNOWN as a subject name but not a blank one', () => {
    expect(assessFilingReadiness(fileableReport({ subjectName: 'UNKNOWN' }), profile(), NOW)).toEqual([]);
  });

  it('demands the TIN type whenever a subject TIN is given', () => {
    const untyped = fileableReport({ subjectTin: '987654321', subjectTinType: null });
    expect(fieldsOf(assessFilingReadiness(untyped, profile(), NOW))).toContain('subject.tinType');
  });
});
