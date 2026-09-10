import ExcelJS from 'exceljs';
import type { RegulatoryReport } from '../../../../domain/model/aggregates/RegulatoryReport.js';
import type { ReportRenderer } from '../../../../domain/ports/ReportRenderer.js';
import { reportHeading, reportRows } from './reportRows.js';

/** XLSX con exceljs (JS puro, sin binarios nativos) — igual que el export de casos. */
export class XlsxRegulatoryReportRenderer implements ReportRenderer {
  readonly format = 'xlsx' as const;
  readonly contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  readonly extension = 'xlsx';

  async render(report: RegulatoryReport): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Reporte regulatorio');
    sheet.columns = [
      { key: 'concept', header: 'Concepto', width: 46 },
      { key: 'value', header: 'Valor', width: 20 },
    ];

    const head = reportHeading(report);
    sheet.spliceRows(1, 0,
      [head.title],
      [head.period],
      [head.state],
      [],
    );
    sheet.getRow(1).font = { bold: true, size: 14 };
    // La misma advertencia que en el PDF, en rojo: un Excel de borrador se
    // reenvia igual de facil.
    sheet.getRow(3).font = { bold: true, color: { argb: report.status === 'ISSUED' ? 'FF047857' : 'FFB91C1C' } };
    sheet.getRow(5).font = { bold: true };

    for (const row of reportRows(report)) {
      sheet.addRow(row);
    }

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer);
  }
}
