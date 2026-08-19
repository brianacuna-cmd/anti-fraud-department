import type { CaseExportRow } from './CaseExportRow.js';
import type { CaseExportRenderer } from './CaseExportRenderer.js';

/** Structured JSON export — the dependency-free default for BI/ops ingestion. */
export class JsonCaseExportRenderer implements CaseExportRenderer {
  readonly format = 'json' as const;
  readonly contentType = 'application/json';
  readonly extension = 'json';

  async render(rows: readonly CaseExportRow[]): Promise<Buffer> {
    return Buffer.from(JSON.stringify({ items: rows, total: rows.length }, null, 2), 'utf-8');
  }
}
