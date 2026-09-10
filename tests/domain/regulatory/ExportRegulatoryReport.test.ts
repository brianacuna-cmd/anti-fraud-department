import ExcelJS from 'exceljs';
import { oid } from '../../support/oid.js';
import { fromDate } from '../../../src/shared/time/Instant.js';
import { createAuthContext } from '../../../src/shared/kernel/AuthContext.js';
import { RegulatoryReport } from '../../../src/modules/regulatory/domain/model/aggregates/RegulatoryReport.js';
import { createRegulatoryReportId } from '../../../src/modules/regulatory/domain/model/value-objects/RegulatoryReportId.js';
import { EMPTY_FIGURES } from '../../../src/modules/regulatory/domain/model/value-objects/RegulatoryFigures.js';
import { createExportRegulatoryReportUseCase } from '../../../src/modules/regulatory/application/ExportRegulatoryReport.js';
import { PdfRegulatoryReportRenderer } from '../../../src/modules/regulatory/infrastructure/adapters/outbound/render/PdfRegulatoryReportRenderer.js';
import { XlsxRegulatoryReportRenderer } from '../../../src/modules/regulatory/infrastructure/adapters/outbound/render/XlsxRegulatoryReportRenderer.js';
import { InMemoryRegulatoryReportRepository } from '../../helpers/regulatory/InMemoryRegulatoryReportRepository.js';
import { InMemoryRegulatoryAuditRecorder } from '../../helpers/regulatory/InMemoryRegulatoryAuditRecorder.js';

const NOW = fromDate(new Date('2026-10-05T00:00:00.000Z'));
const SEP_START = fromDate(new Date('2026-09-01T00:00:00.000Z'));
const SEP_END = fromDate(new Date('2026-09-30T00:00:00.000Z'));
const ORG_1 = oid('org-1');
const ID = createRegulatoryReportId(oid('rep-1'));

const SUPERVISOR = createAuthContext({
  userId: oid('sup-1'),
  organizationId: ORG_1,
  actorType: 'USER',
  roleId: 'SUPERVISOR',
});

function draft(): RegulatoryReport {
  return RegulatoryReport.create({
    id: ID,
    organizationId: ORG_1,
    periodStart: SEP_START,
    periodEnd: SEP_END,
    figures: { ...EMPTY_FIGURES, casesOpened: 120, fraudConfirmed: 14, sarsFiled: 3 },
    generatedBy: oid('sup-1'),
    now: NOW,
  });
}

function build(report: RegulatoryReport) {
  const reports = new InMemoryRegulatoryReportRepository();
  reports.seed(report);
  const auditRecorder = new InMemoryRegulatoryAuditRecorder();

  const exportRegulatoryReport = createExportRegulatoryReportUseCase({
    reports,
    renderers: [new PdfRegulatoryReportRenderer(), new XlsxRegulatoryReportRenderer()],
    auditRecorder,
  });

  return { exportRegulatoryReport, auditRecorder };
}

/** Lee la primera hoja del XLSX como matriz de texto. */
async function readSheet(body: Buffer): Promise<string[][]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(body as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0]!;
  const rows: string[][] = [];
  sheet.eachRow((row) => {
    rows.push((row.values as unknown[]).slice(1).map((v) => String(v ?? '')));
  });
  return rows;
}

describe('createExportRegulatoryReportUseCase', () => {
  it('produce un PDF real', async () => {
    const { exportRegulatoryReport } = build(draft());

    const file = await exportRegulatoryReport({ auth: SUPERVISOR, reportId: ID, format: 'pdf' });

    expect(file.contentType).toBe('application/pdf');
    // Los primeros bytes de todo PDF. Comprobar solo que hay bytes dejaría
    // pasar un fichero corrupto.
    expect(file.body.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(file.filename).toBe('reporte-regulatorio-2026-09-01_2026-09-30.pdf');
  });

  it('el XLSX lleva las cifras y dice NO DISPONIBLE en montos bloqueados', async () => {
    const { exportRegulatoryReport } = build(draft());

    const file = await exportRegulatoryReport({ auth: SUPERVISOR, reportId: ID, format: 'xlsx' });
    const rows = await readSheet(file.body);
    const plano = rows.map((r) => r.join(' | ')).join('\n');

    expect(plano).toContain('Expedientes abiertos | 120');
    expect(plano).toContain('Fraude confirmado | 14');
    // La fila se imprime aunque no haya dato: omitirla dejaría al lector sin
    // saber que la cifra existe y falta.
    expect(plano).toContain('Montos bloqueados | No disponible');
  });

  it('un borrador se marca COMO TAL en el propio fichero', async () => {
    const { exportRegulatoryReport } = build(draft());

    const file = await exportRegulatoryReport({ auth: SUPERVISOR, reportId: ID, format: 'xlsx' });
    const plano = (await readSheet(file.body)).map((r) => r.join(' ')).join('\n');

    // Un borrador exportado acaba reenviado por correo, y para entonces nadie
    // recuerda que lo era: la advertencia tiene que viajar EN el papel.
    expect(plano).toContain('BORRADOR');
    expect(file.issued).toBe(false);
  });

  it('un reporte emitido no lleva la advertencia y dice cuándo se emitió', async () => {
    const emitido = draft().issue(oid('sup-2'), NOW);
    const { exportRegulatoryReport } = build(emitido);

    const file = await exportRegulatoryReport({ auth: SUPERVISOR, reportId: ID, format: 'xlsx' });
    const plano = (await readSheet(file.body)).map((r) => r.join(' ')).join('\n');

    expect(plano).not.toContain('BORRADOR');
    expect(plano).toContain('Emitido el 2026-10-05');
    expect(file.issued).toBe(true);
  });

  it('deja traza de que el documento salió, con formato y tamaño', async () => {
    const { exportRegulatoryReport, auditRecorder } = build(draft());

    const file = await exportRegulatoryReport({ auth: SUPERVISOR, reportId: ID, format: 'pdf' });

    const [event] = auditRecorder.all();
    expect(event!.action).toBe('EXPORT_REGULATORY_REPORT');
    expect(event!.detail.format).toBe('pdf');
    expect(event!.detail.status).toBe('DRAFT');
    expect(event!.detail.bytes).toBe(file.body.byteLength);
  });

  it('a report from another tenant is not found', async () => {
    const { exportRegulatoryReport } = build(draft());
    const otherOrg = createAuthContext({
      userId: oid('sup-2'),
      organizationId: oid('org-2'),
      actorType: 'USER',
      roleId: 'SUPERVISOR',
    });

    await expect(
      exportRegulatoryReport({ auth: otherOrg, reportId: ID, format: 'pdf' }),
    ).rejects.toMatchObject({ code: 'REGULATORY_REPORT_NOT_FOUND' });
  });

  it('un formato que no existe se rechaza nombrando los que sí', async () => {
    const { exportRegulatoryReport } = build(draft());

    await expect(
      exportRegulatoryReport({ auth: SUPERVISOR, reportId: ID, format: 'csv' as 'pdf' }),
    ).rejects.toMatchObject({
      code: 'INVARIANT_VIOLATION',
      metadata: { supported: ['pdf', 'xlsx'] },
    });
  });
});
