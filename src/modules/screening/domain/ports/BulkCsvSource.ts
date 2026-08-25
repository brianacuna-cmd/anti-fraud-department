/**
 * Raw shape of one CSV data row. `customer_id` is always present as a string
 * (may be empty — the worker decides if that is a row error). All other
 * columns are optional; missing columns are `undefined`.
 */
export interface CsvRow {
  readonly customer_id: string;
  readonly entry_type?: string;
  readonly name?: string;
  readonly document?: string;
  readonly wallet_address?: string;
}

/**
 * Domain port for reading bulk CSV files. Keeps `csv-parse` and `fs` out of
 * the application layer (eslint `boundaries`: application → own domain only).
 */
export interface BulkCsvSource {
  /**
   * Streams data rows from the CSV at `filePath`. The header row is consumed
   * internally. Throws `ScreeningError('CSV_HEADER_INVALID')` if the header
   * does not contain a `customer_id` column. Throws for unreadable files and
   * parse errors. Empty `customer_id` on a data row is yielded — the caller
   * is responsible for treating it as a row error.
   */
  readRows(filePath: string): AsyncIterable<CsvRow>;

  /**
   * Deletes the file at `filePath`. Called by the worker after reaching a
   * terminal state to remove temporary PII data.
   */
  discard(filePath: string): Promise<void>;
}
