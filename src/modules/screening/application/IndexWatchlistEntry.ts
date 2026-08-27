import type { WatchlistEntryId } from '../domain/model/value-objects/WatchlistEntryId.js';
import type { NameNormalizer } from '../domain/ports/NameNormalizer.js';
import type { PhoneticEncoder } from '../domain/ports/PhoneticEncoder.js';
import type { WatchlistEntryRepository } from '../domain/ports/WatchlistEntryRepository.js';
import type { Transaction } from '../domain/ports/UnitOfWork.js';

export interface IndexWatchlistEntryDeps {
  readonly watchlistEntryRepository: WatchlistEntryRepository;
  readonly nameNormalizer: NameNormalizer;
  readonly phoneticEncoder: PhoneticEncoder;
}

export interface IndexWatchlistEntryInput {
  readonly entryId: WatchlistEntryId;
  /** Optional transaction — pass when called inside a `withTransaction` block (ADR-3). */
  readonly tx?: Transaction;
}

/**
 * Write-path use case (spec NFI: single shared normalizer used at
 * write+read; deferred task 5.2, promoted into Slice 6). Runs whenever a
 * watchlist entry is created/updated: normalizes `name` with the SAME
 * `NameNormalizer` the query path (`ScreenSubjectAgainstWatchlist`) uses,
 * and precomputes `phonetic_keys` per normalized token via the injected
 * `PhoneticEncoder`. Persists both onto the entry document so the
 * `watchlist_entries` blocking indexes (`ensureIndexes.ts`) stay accurate.
 *
 * No-op when the entry does not exist (e.g. already deleted by the time an
 * async/outbox-driven indexing job runs) rather than throwing.
 *
 * ADR-3: `tx` is threaded through to `findToIndex`/`updateIndexedFields` so
 * normalization commits atomically with the entry write when called from a
 * `CreateWatchlistEntry`/`UpdateWatchlistEntry` use case.
 */
export function createIndexWatchlistEntryUseCase(deps: IndexWatchlistEntryDeps) {
  const { watchlistEntryRepository, nameNormalizer, phoneticEncoder } = deps;

  return async function indexWatchlistEntry(input: IndexWatchlistEntryInput): Promise<void> {
    const entry = await watchlistEntryRepository.findToIndex(input.entryId, input.tx);
    if (!entry) {
      return;
    }

    const normalizedName = nameNormalizer.normalize(entry.name);
    const tokens = normalizedName.length > 0 ? normalizedName.split(' ') : [];
    const phoneticKeys = Array.from(new Set(tokens.flatMap((token) => phoneticEncoder.encode(token))));

    await watchlistEntryRepository.updateIndexedFields(entry.id, { normalizedName, phoneticKeys }, input.tx);
  };
}
