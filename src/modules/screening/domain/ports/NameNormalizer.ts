/**
 * The single shared normalization contract used at both write time
 * (indexing a watchlist entry) and read time (screening a subject). Using
 * the same pure function at both paths prevents silent blocking misses
 * caused by divergent normalization rules.
 *
 * This is a pure domain-level port: no IO, no third-party dependency. A
 * later slice may wrap this in an injectable `NameNormalizer` port shape if
 * an adapter needs to swap implementations, but the reference
 * implementation below is authoritative and is what both matching adapters
 * and indexing use directly.
 */
export interface NameNormalizer {
  normalize(raw: string): string;
}

const COMBINING_DIACRITICS_PATTERN = /[̀-ͯ]/g;
const PUNCTUATION_PATTERN = /[^\p{L}\p{N}\s]/gu;
const WHITESPACE_PATTERN = /\s+/g;

/**
 * NFD-normalizes, strips combining accents, lowercases, strips punctuation
 * entirely (not replaced with whitespace, so contractions like "O'Brien"
 * collapse to "obrien"), and collapses whitespace into single spaces.
 * Idempotent: normalizing an already-normalized string returns it unchanged.
 */
export function normalizeName(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(COMBINING_DIACRITICS_PATTERN, '')
    .toLowerCase()
    .replace(PUNCTUATION_PATTERN, '')
    .trim()
    .replace(WHITESPACE_PATTERN, ' ');
}

export const referenceNameNormalizer: NameNormalizer = {
  normalize: normalizeName,
};
