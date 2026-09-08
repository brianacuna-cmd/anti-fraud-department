import { oid } from '../../../support/oid.js';
import { SarXmlRenderer } from '../../../../src/modules/sar/infrastructure/adapters/inbound/http/xml/SarXmlRenderer.js';
import { SarReport } from '../../../../src/modules/sar/domain/model/aggregates/SarReport.js';
import { generateSarReportId } from '../../../../src/modules/sar/domain/model/value-objects/SarReportId.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const LATER = fromDate(new Date('2026-01-02T00:00:00.000Z'));
const ORG_1 = oid('org-1');

function approvedComplete(overrides: { narrative?: string; subjectName?: string } = {}) {
  const report = SarReport.create({
    id: generateSarReportId(),
    organizationId: ORG_1,
    caseId: oid('case-1'),
    narrative: overrides.narrative ?? 'Volumen atípico de transferencias fuera del patrón habitual del cliente.',
    subjectName: overrides.subjectName ?? 'Jane Doe',
    suspiciousAmount: 15000,
    activityStartDate: NOW,
    activityEndDate: LATER,
    createdBy: oid('sup-1'),
    now: NOW,
  });
  return report.approve(oid('sup-2'), LATER);
}

describe('SarXmlRenderer', () => {
  it('produce un XML bien formado con los campos esperados', () => {
    const renderer = new SarXmlRenderer();
    const report = approvedComplete();

    const body = renderer.render(report).toString('utf-8');

    expect(body.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(body).toContain('<SARFiling xmlns="urn:aftd:sar:amlr-4.0" schemaVersion="AMLR-4.0">');
    expect(body).toContain(`<ReportId>${report.id}</ReportId>`);
    expect(body).toContain(`<CaseId>${oid('case-1')}</CaseId>`);
    expect(body).toContain('<Status>APPROVED</Status>');
    expect(body).toContain(`<ApprovedBy>${oid('sup-2')}</ApprovedBy>`);
    expect(body).toContain('<SubjectName>Jane Doe</SubjectName>');
    expect(body).toContain('<SuspiciousAmount>15000</SuspiciousAmount>');
  });

  it('escapa caracteres especiales en narrative y subjectName', () => {
    const renderer = new SarXmlRenderer();
    const report = approvedComplete({
      narrative: 'Transferencias entre "empresas fantasma" & cuentas <off-shore> del sujeto.',
      subjectName: 'O\'Brien & Sons',
    });

    const body = renderer.render(report).toString('utf-8');

    expect(body).not.toContain('<off-shore>');
    expect(body).toContain('&amp;');
    expect(body).toContain('&quot;empresas fantasma&quot;');
    expect(body).toContain('O&apos;Brien &amp; Sons');
  });

  it('lanza SAR_NOT_APPROVED para un reporte en DRAFT', () => {
    const renderer = new SarXmlRenderer();
    const report = SarReport.create({
      id: generateSarReportId(),
      organizationId: ORG_1,
      caseId: oid('case-1'),
      narrative: 'Volumen atípico de transferencias fuera del patrón habitual del cliente.',
      createdBy: oid('sup-1'),
      now: NOW,
    });

    expect(() => renderer.render(report)).toThrow(
      expect.objectContaining({ code: 'SAR_NOT_APPROVED' }),
    );
  });
});
