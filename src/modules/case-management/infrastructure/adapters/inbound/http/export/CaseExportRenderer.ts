import type { CaseExportRow } from './CaseExportRow.js';

export type CaseExportFormat = 'json' | 'xlsx' | 'pdf';

/**
 * Presentation adapter that renders filtered case rows into a downloadable
 * document of one format. Format selection is an HTTP concern (the `format`
 * query param) — the `ExportCases` use case stays format-agnostic and only
 * yields the domain rows.
 */
export interface CaseExportRenderer {
  readonly format: CaseExportFormat;
  readonly contentType: string;
  readonly extension: string;
  render(rows: readonly CaseExportRow[]): Promise<Buffer>;
}
