/**
 * Own copy of identity-access's `duplicateKey.ts` — eslint `boundaries`
 * forbids cross-module imports, so each module carries its own translation
 * helper (same pattern as `domain/services/transitions.ts` being duplicated
 * per module, see Slice 1 apply-progress).
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
 * (E11000) — the decision that follows compares this name against a known
 * constant (e.g. `'org_fraud_config_unique'`), never the raw message text.
 */
export function extractDuplicateKeyIndexName(error: unknown): string | undefined {
  if (!isDuplicateKeyError(error)) {
    return undefined;
  }
  const message = error.errmsg ?? error.message ?? '';
  return INDEX_NAME_PATTERN.exec(message)?.[1];
}
