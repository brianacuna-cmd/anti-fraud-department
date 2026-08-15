/**
 * Closed set of error codes owned by the `ingest` module. HTTP mapping
 * lives in the HTTP layer later — never here.
 */
export type IngestErrorCode =
  | 'INVARIANT_VIOLATION'
  | 'FORBIDDEN_CROSS_TENANT'
  | 'FORBIDDEN_ROLE'
  | 'WEBHOOK_SIGNATURE_INVALID'
  | 'WEBHOOK_SECRET_NOT_FOUND';
