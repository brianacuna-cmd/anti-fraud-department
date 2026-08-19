import PDFDocument from 'pdfkit';
import type { CaseExportRow } from './CaseExportRow.js';
import type { CaseExportRenderer } from './CaseExportRenderer.js';

interface PdfColumn {
  readonly header: string;
  readonly value: (row: CaseExportRow) => string;
  readonly width: number;
}

/** Compact column subset that fits a portrait Letter page (~468pt usable). */
const PDF_COLUMNS: readonly PdfColumn[] = [
  { header: 'Case ID', value: (r) => r.id, width: 130 },
  { header: 'Status', value: (r) => r.status, width: 70 },
  { header: 'Priority', value: (r) => r.priority, width: 55 },
  { header: 'Risk', value: (r) => String(r.riskScore), width: 35 },
  { header: 'Customer', value: (r) => r.customerId, width: 90 },
  { header: 'Due Date', value: (r) => r.dueDate, width: 88 },
];

const MARGIN = 36;
const ROW_HEIGHT = 16;
const FONT_SIZE = 8;

/** PDF export via pdfkit (pure JS, no headless browser). */
export class PdfCaseExportRenderer implements CaseExportRenderer {
  readonly format = 'pdf' as const;
  readonly contentType = 'application/pdf';
  readonly extension = 'pdf';

  async render(rows: readonly CaseExportRow[]): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'LETTER', margin: MARGIN });
    const chunks: Buffer[] = [];
    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    doc.fontSize(14).text('Cases Export', { align: 'left' });
    doc.moveDown(0.3);
    doc.fontSize(9).fillColor('#555555').text(`${rows.length} case(s) — generated ${new Date().toISOString()}`);
    doc.moveDown(0.6).fillColor('#000000');

    let y = doc.y;
    y = this.drawRow(doc, PDF_COLUMNS.map((c) => c.header), y, true);
    for (const row of rows) {
      if (y + ROW_HEIGHT > doc.page.height - MARGIN) {
        doc.addPage();
        y = MARGIN;
        y = this.drawRow(doc, PDF_COLUMNS.map((c) => c.header), y, true);
      }
      y = this.drawRow(doc, PDF_COLUMNS.map((c) => c.value(row)), y, false);
    }

    doc.end();
    return done;
  }

  private drawRow(
    doc: PDFKit.PDFDocument,
    cells: readonly string[],
    y: number,
    header: boolean,
  ): number {
    let x = MARGIN;
    doc.fontSize(FONT_SIZE).font(header ? 'Helvetica-Bold' : 'Helvetica');
    cells.forEach((text, index) => {
      const column = PDF_COLUMNS[index]!;
      doc.text(text, x + 2, y + 4, { width: column.width - 4, height: ROW_HEIGHT, ellipsis: true });
      x += column.width;
    });
    doc
      .moveTo(MARGIN, y + ROW_HEIGHT)
      .lineTo(MARGIN + PDF_COLUMNS.reduce((sum, c) => sum + c.width, 0), y + ROW_HEIGHT)
      .strokeColor('#dddddd')
      .stroke();
    return y + ROW_HEIGHT;
  }
}
