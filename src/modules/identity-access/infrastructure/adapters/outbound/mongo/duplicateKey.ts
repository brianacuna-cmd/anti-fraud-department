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
 * (E11000) — the decision that follows compares this name against a known
 * constant (e.g. `'slug_unique'`), never the raw message text or the
 * conflicting field values (task: "by index name, not message parsing").
 */
export function extractDuplicateKeyIndexName(error: unknown): string | undefined {
  if (!isDuplicateKeyError(error)) {
    return undefined;
  }
  const message = error.errmsg ?? error.message ?? '';
  return INDEX_NAME_PATTERN.exec(message)?.[1];
}
