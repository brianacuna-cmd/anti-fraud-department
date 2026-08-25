import { oid } from '../../support/oid.js';
import { CaseReportPdfRenderer } from '../../../src/modules/case-management/infrastructure/adapters/inbound/http/report/CaseReportPdfRenderer.js';
import { CaseReport } from '../../../src/modules/case-management/domain/model/aggregates/CaseReport.js';
import { createCaseId } from '../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { createCaseReportId } from '../../../src/modules/case-management/domain/model/value-objects/CaseReportId.js';
import { fromDate } from '../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-08-20T15:36:00.000Z'));
const ORG = oid('org-1');
const CASE_ID = oid('case-1');
const REPORT_ID = oid('report-1');

function buildReport(snapshot: Record<string, unknown>): CaseReport {
  return CaseReport.create({
    id: createCaseReportId(REPORT_ID),
    caseId: createCaseId(CASE_ID),
    organizationId: ORG,
    generatedBy: oid('analyst-1'),
    snapshot,
    now: NOW,
  });
}

const FULL_SNAPSHOT = {
  generatedAt: NOW,
  case: {
    id: CASE_ID,
    status: 'IN_REVIEW',
    priority: 'CRITICAL',
    riskScore: 55,
    customerId: '1887',
    assignedTo: { type: 'USER', id: oid('analyst-1') },
    dueDate: NOW,
    tags: ['chargeback', 'reincidente'],
    createdAt: NOW,
    updatedAt: NOW,
  },
  timeline: [
    { id: oid('ev-1'), eventType: 'STATE_CHANGED', previousValue: 'OPEN', newValue: 'IN_REVIEW', createdBy: oid('analyst-1'), createdAt: NOW },
  ],
  notes: [{ id: oid('note-1'), authorId: oid('analyst-1'), body: 'Movimientos inusuales de madrugada', createdAt: NOW }],
  investigations: [
    { id: oid('inv-1'), subjectType: 'CUSTOMER', subjectId: '1887', status: 'CLOSED', findings: 'Sin coincidencias en listas', openedBy: oid('analyst-1'), createdAt: NOW, closedAt: NOW },
  ],
  resolutions: [{ id: oid('res-1'), closureType: 'CONFIRMED_FRAUD', reason: 'Patrón confirmado', resolvedBy: oid('sup-1'), createdAt: NOW }],
  enforcementActions: [
    { id: oid('act-1'), actionType: 'BLOCK', targetType: 'WALLET', targetId: '0xabc', status: 'EXECUTED', createdBy: oid('analyst-1'), createdAt: NOW },
  ],
  analystDecisions: [
    { id: oid('dec-1'), decision: 'CONFIRMED_FRAUD', confidence: 90, comment: 'Coincide con el patrón de la alerta', createdBy: oid('analyst-1'), createdAt: NOW },
  ],
};

/** Los PDF empiezan por `%PDF-` y terminan por `%%EOF`. */
function isPdf(buffer: Buffer): boolean {
  return buffer.subarray(0, 5).toString('latin1') === '%PDF-' && buffer.includes('%%EOF');
}

describe('CaseReportPdfRenderer', () => {
  it('renders a complete snapshot as a non-trivial PDF document', async () => {
    const pdf = await new CaseReportPdfRenderer().render(buildReport(FULL_SNAPSHOT));

    expect(isPdf(pdf)).toBe(true);
    // A PDF with only the header and no section is around 1 kB; this one
    // carries six blocks with content.
    expect(pdf.byteLength).toBeGreaterThan(2000);
  });

  /**
   * A report freezes what WAS. A snapshot from six months ago may not have
   * today's shape — a key that did not exist yet, a field that changed type —
   * and it still has to print: it is the piece sent to a regulator, and
   * failing to open it turns it into wet paper.
   */
  it.each([
    ['vacío', {}],
    ['sin la clave `case`', { timeline: [], notes: [] }],
    ['con listas que no son listas', { case: { id: CASE_ID }, timeline: 'nope', notes: 42, investigations: null }],
    ['con valores de otro tipo', { case: { id: CASE_ID, tags: [1, 2], assignedTo: 'suelto', riskScore: null } }],
    ['con filas que no son objetos', { case: {}, notes: ['solo texto', null, 7] }],
  ])('still renders a snapshot %s', async (_label, snapshot) => {
    const pdf = await new CaseReportPdfRenderer().render(buildReport(snapshot as Record<string, unknown>));

    expect(isPdf(pdf)).toBe(true);
  });

  it('paginates a snapshot too long for one page', async () => {
    const many = Array.from({ length: 400 }, (_, index) => ({
      id: oid(`note-${index}`),
      authorId: oid('analyst-1'),
      body: `Nota número ${index} con texto suficiente para ocupar su línea entera del informe.`,
      createdAt: NOW,
    }));

    const pdf = await new CaseReportPdfRenderer().render(
      buildReport({ ...FULL_SNAPSHOT, notes: many }),
    );

    expect(isPdf(pdf)).toBe(true);
    // `/Type /Page` appears once per page; with 400 notes there are several.
    const pages = pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? [];
    expect(pages.length).toBeGreaterThan(1);
  });
});
