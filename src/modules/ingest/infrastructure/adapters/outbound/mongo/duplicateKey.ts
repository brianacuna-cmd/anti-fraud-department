/**
 * Own copy of identity-access `duplicateKey.ts` — eslint boundaries forbid
 * cross-module imports (same pattern as case-management).
 */
const DUPLICATE_KEY_CODE = 11000;
const INDEX_NAME_PATTERN = /index:\s*([^\s,]+)/;

interface MongoLikeError {
  readonly code?: number;
  readonly errmsg?: string;
  readonly message?: string;
}

export function isDuplicateKeyError(error: unknown): error is MongoLikeError {
  return typeof error === 'object' && error !== null && (error as MongoLikeError).code === DUPLICATE_KEY_CODE;
}

export function extractDuplicateKeyIndexName(error: unknown): string | undefined {
  if (!isDuplicateKeyError(error)) {
    return undefined;
  }
  const message = error.errmsg ?? error.message ?? '';
  return INDEX_NAME_PATTERN.exec(message)?.[1];
}

export const PROVIDER_INGEST_EVENT_UNIQUE_INDEX = 'provider_ingest_event_org_provider_event_unique';
