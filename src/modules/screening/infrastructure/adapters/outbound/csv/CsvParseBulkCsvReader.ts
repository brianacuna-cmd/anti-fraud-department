import { createReadStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { parse } from 'csv-parse';
import type { BulkCsvSource, CsvRow } from '../../../../domain/ports/BulkCsvSource.js';
import { csvHeaderInvalid } from '../../../../domain/errors/ScreeningError.js';

/**
 * Streams a CSV file from disk using `csv-parse`. Validates that the header
 * row contains `customer_id` — throws `ScreeningError('CSV_HEADER_INVALID')`
 * if not. Per the eslint `boundaries` rule, the use-case layer MUST NOT
 * import this adapter directly — it depends only on `BulkCsvSource`.
 */
export class CsvParseBulkCsvReader implements BulkCsvSource {
  async *readRows(filePath: string): AsyncGenerator<CsvRow> {
    const input = createReadStream(filePath);
    const parser = parse({
      columns: (header: string[]) => {
        if (!header.includes('customer_id')) {
          throw csvHeaderInvalid(filePath);
        }
        return header;
      },
      skip_empty_lines: true,
      trim: true,
    });

    // Forward source-stream errors (e.g. ENOENT) through the parser so
    // the `for await` below receives them as thrown exceptions.
    input.on('error', (err) => parser.destroy(err));
    input.pipe(parser);

    for await (const record of parser) {
      yield record as CsvRow;
    }
  }

  async discard(filePath: string): Promise<void> {
    await unlink(filePath);
  }
}
