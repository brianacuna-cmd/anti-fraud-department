import ExcelJS from 'exceljs';
import { CASE_EXPORT_COLUMNS, type CaseExportRow } from './CaseExportRow.js';
import type { CaseExportRenderer } from './CaseExportRenderer.js';

/** XLSX export via exceljs (pure JS, no native binaries). */
export class XlsxCaseExportRenderer implements CaseExportRenderer {
  readonly format = 'xlsx' as const;
  readonly contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  readonly extension = 'xlsx';

  async render(rows: readonly CaseExportRow[]): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Cases');
    sheet.columns = CASE_EXPORT_COLUMNS.map((column) => ({
      key: column.key,
      header: column.header,
      width: 22,
    }));
    sheet.getRow(1).font = { bold: true };
    for (const row of rows) {
      sheet.addRow(row);
    }
    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer);
  }
}
