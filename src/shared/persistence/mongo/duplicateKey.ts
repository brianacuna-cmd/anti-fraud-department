/**
 * Shared Mongo duplicate-key (E11000) detection helper, consumed by every
 * module that previously carried its own byte-identical copy.
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

/**
 * Extracts the offending index's NAME from a Mongo duplicate-key error
 * (E11000) — callers compare this name against a known constant (e.g.
 * `'org_fraud_config_unique'`), never the raw message text.
 */
export function extractDuplicateKeyIndexName(error: unknown): string | undefined {
  if (!isDuplicateKeyError(error)) {
    return undefined;
  }
  const message = error.errmsg ?? error.message ?? '';
  return INDEX_NAME_PATTERN.exec(message)?.[1];
}
