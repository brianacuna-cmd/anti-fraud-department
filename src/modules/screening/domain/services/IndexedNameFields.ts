import type { NameNormalizer } from '../ports/NameNormalizer.js';
import type { PhoneticEncoder } from '../ports/PhoneticEncoder.js';
import type { WatchlistEntryIndexedFields } from '../ports/WatchlistEntryRepository.js';

/**
 * Computes the blocking-layer fields for a watchlist entry name.
 *
 * The single place this derivation lives. `IndexWatchlistEntry` (one entry at
 * a time) and the bulk sanctions sync both call it, so an entry written by
 * either path is found by the same candidate query — the spec's
 * single-normalizer invariant, now enforced by construction instead of by
 * keeping two copies in step.
 */
export function computeIndexedNameFields(
  name: string,
  normalizer: NameNormalizer,
  encoder: PhoneticEncoder,
): WatchlistEntryIndexedFields {
  const normalizedName = normalizer.normalize(name);
  const tokens = normalizedName.length > 0 ? normalizedName.split(' ') : [];
  const phoneticKeys = Array.from(new Set(tokens.flatMap((token) => encoder.encode(token))));
  return { normalizedName, phoneticKeys };
}
