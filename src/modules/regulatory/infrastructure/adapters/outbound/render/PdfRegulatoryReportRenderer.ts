import PDFDocument from 'pdfkit';
import type { RegulatoryReport } from '../../../../domain/model/aggregates/RegulatoryReport.js';
import type { ReportRenderer } from '../../../../domain/ports/ReportRenderer.js';
import { reportHeading, reportRows } from './reportRows.js';

const MARGIN = 48;
const ROW_HEIGHT = 22;

/** PDF con pdfkit (JS puro, sin navegador headless) — igual que el export de casos. */
export class PdfRegulatoryReportRenderer implements ReportRenderer {
  readonly format = 'pdf' as const;
  readonly contentType = 'application/pdf';
  readonly extension = 'pdf';

  async render(report: RegulatoryReport): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'LETTER', margin: MARGIN });
    const chunks: Buffer[] = [];
    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    const head = reportHeading(report);

    doc.fontSize(16).fillColor('#0f172a').text(head.title);
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor('#475569').text(head.period);

    /*
     * La marca de borrador va en ROJO y en la portada.
     *
     * Un borrador exportado acaba reenviado por correo tarde o temprano, y para
     * entonces nadie recuerda que lo era. La advertencia tiene que viajar EN el
     * papel, no en la pantalla desde la que se descargó.
     */
    doc.moveDown(0.2);
    doc
      .fontSize(10)
      .fillColor(report.status === 'ISSUED' ? '#047857' : '#b91c1c')
      .text(head.state);

    doc.moveDown(1).fillColor('#0f172a');

    let y = doc.y;
    for (const row of reportRows(report)) {
      if (y + ROW_HEIGHT > doc.page.height - MARGIN) {
        doc.addPage();
        y = MARGIN;
      }
      doc.fontSize(10).fillColor('#334155').text(row.concept, MARGIN, y, { width: 340 });
      doc
        .fontSize(10)
        .fillColor('#0f172a')
        .text(row.value, MARGIN + 350, y, { width: 130, align: 'right' });
      y += ROW_HEIGHT;
    }

    doc.moveDown(2);
    doc
      .fontSize(8)
      .fillColor('#64748b')
      .text(
        `Generado el ${report.generatedAt.slice(0, 19).replace('T', ' ')} UTC · reporte ${report.id}`,
        MARGIN,
        y + 16,
      );

    doc.end();
    return done;
  }
}
