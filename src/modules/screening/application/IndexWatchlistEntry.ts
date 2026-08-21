import type { WatchlistEntryId } from '../domain/model/value-objects/WatchlistEntryId.js';
import type { NameNormalizer } from '../domain/ports/NameNormalizer.js';
import type { PhoneticEncoder } from '../domain/ports/PhoneticEncoder.js';
import type { WatchlistEntryRepository } from '../domain/ports/WatchlistEntryRepository.js';

export interface IndexWatchlistEntryDeps {
  readonly watchlistEntryRepository: WatchlistEntryRepository;
  readonly nameNormalizer: NameNormalizer;
  readonly phoneticEncoder: PhoneticEncoder;
}

export interface IndexWatchlistEntryInput {
  readonly entryId: WatchlistEntryId;
}

/**
 * Write-path use case (spec NFI: single shared normalizer used at
 * write+read; deferred task 5.2, promoted into Slice 6). Runs whenever a
 * watchlist entry is created/updated: normalizes `nombre` with the SAME
 * `NameNormalizer` the query path (`ScreenSubjectAgainstWatchlist`) uses,
 * and precomputes `phonetic_keys` per normalized token via the injected
 * `PhoneticEncoder`. Persists both onto the entry document so the
 * `watchlist_entries` blocking indexes (`ensureIndexes.ts`) stay accurate.
 *
 * No-op when the entry does not exist (e.g. already deleted by the time an
 * async/outbox-driven indexing job runs) rather than throwing.
 */
export function createIndexWatchlistEntryUseCase(deps: IndexWatchlistEntryDeps) {
  const { watchlistEntryRepository, nameNormalizer, phoneticEncoder } = deps;

  return async function indexWatchlistEntry(input: IndexWatchlistEntryInput): Promise<void> {
    const entry = await watchlistEntryRepository.findToIndex(input.entryId);
    if (!entry) {
      return;
    }

    const nombreNormalizado = nameNormalizer.normalize(entry.nombre);
    const tokens = nombreNormalizado.length > 0 ? nombreNormalizado.split(' ') : [];
    const phoneticKeys = Array.from(new Set(tokens.flatMap((token) => phoneticEncoder.encode(token))));

    await watchlistEntryRepository.updateIndexedFields(entry.id, {
      nombreNormalizado,
      phoneticKeys,
    });
  };
}
