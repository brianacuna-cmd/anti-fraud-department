import { oid } from '../../../support/oid.js';
import { assertReadyForFiling } from '../../../../src/modules/sar/domain/services/assertReadyForFiling.js';
import { SarReport } from '../../../../src/modules/sar/domain/model/aggregates/SarReport.js';
import { generateSarReportId } from '../../../../src/modules/sar/domain/model/value-objects/SarReportId.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const LATER = fromDate(new Date('2026-01-02T00:00:00.000Z'));
const ORG_1 = oid('org-1');

function draft(overrides: Partial<Parameters<typeof SarReport.create>[0]> = {}) {
  return SarReport.create({
    id: generateSarReportId(),
    organizationId: ORG_1,
    caseId: oid('case-1'),
    narrative: 'Volumen atípico de transferencias fuera del patrón habitual del cliente.',
    createdBy: oid('sup-1'),
    now: NOW,
    ...overrides,
  });
}

function approvedComplete() {
  return draft({
    subjectName: 'Jane Doe',
    suspiciousAmount: 15000,
    activityStartDate: NOW,
  }).approve(oid('sup-2'), LATER);
}

describe('assertReadyForFiling', () => {
  it('rechaza un reporte que aún no está APPROVED', () => {
    const report = draft();

    expect(() => assertReadyForFiling(report)).toThrow(
      expect.objectContaining({ code: 'SAR_NOT_APPROVED' }),
    );
  });

  it('rechaza un reporte APPROVED al que le faltan campos de filing, listando todos los errores', () => {
    const report = draft().approve(oid('sup-2'), LATER);

    try {
      assertReadyForFiling(report);
      throw new Error('expected assertReadyForFiling to throw');
    } catch (err) {
      expect((err as { code: string }).code).toBe('SAR_XML_VALIDATION_FAILED');
      const errors = (err as { metadata: { errors: string[] } }).metadata.errors;
      expect(errors).toEqual(
        expect.arrayContaining([
          expect.stringContaining('subjectName'),
          expect.stringContaining('suspiciousAmount'),
          expect.stringContaining('activityStartDate'),
        ]),
      );
    }
  });

  it('rechaza cuando activityEndDate es anterior a activityStartDate', () => {
    const report = draft({
      subjectName: 'Jane Doe',
      suspiciousAmount: 15000,
      activityStartDate: LATER,
      activityEndDate: NOW,
    }).approve(oid('sup-2'), LATER);

    try {
      assertReadyForFiling(report);
      throw new Error('expected assertReadyForFiling to throw');
    } catch (err) {
      const errors = (err as { metadata: { errors: string[] } }).metadata.errors;
      expect(errors).toEqual(
        expect.arrayContaining([expect.stringContaining('activityEndDate')]),
      );
    }
  });

  it('no lanza para un reporte APPROVED y completo', () => {
    expect(() => assertReadyForFiling(approvedComplete())).not.toThrow();
  });
});
