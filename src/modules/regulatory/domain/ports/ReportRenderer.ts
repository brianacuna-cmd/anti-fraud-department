import type { RegulatoryReport } from '../model/aggregates/RegulatoryReport.js';

export type ReportFormat = 'pdf' | 'xlsx';

/**
 * Convierte un reporte en el fichero que se presenta.
 *
 * Un puerto por formato y no un `render(format)` con un switch: cada
 * renderizador trae su propia librería pesada, y el que decide cuál se usa es
 * la composición, no el caso de uso.
 */
export interface ReportRenderer {
  readonly format: ReportFormat;
  readonly contentType: string;
  readonly extension: string;
  render(report: RegulatoryReport): Promise<Buffer>;
}
