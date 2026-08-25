import type { WatchlistEntryId } from '../model/value-objects/WatchlistEntryId.js';
import type { WatchlistId } from '../model/value-objects/WatchlistId.js';
import type { Instant } from '../../../../shared/time/Instant.js';
import type { Transaction } from './UnitOfWork.js';

/**
 * Write-path port for the `watchlist_entries` collection (spec NFI: single
 * shared normalizer used at write+read). `IndexWatchlistEntry` (application
 * layer) uses this to persist the precomputed `normalizedName` and
 * `phoneticKeys` fields the blocking-layer indexes (`ensureIndexes.ts`)
 * query on. Read-path candidate lookup stays on `WatchlistCandidateRepository`
 * — this port is write-only and intentionally minimal.
 */
export interface WatchlistEntryIndexedFields {
  readonly normalizedName: string;
  readonly phoneticKeys: readonly string[];
}

export interface WatchlistEntryToIndex {
  readonly id: WatchlistEntryId;
  readonly name: string;
}

export interface WatchlistEntryRepository {
  /** Fetches the minimal fields (id + raw name) needed to (re)compute indexed fields. */
  findToIndex(id: WatchlistEntryId): Promise<WatchlistEntryToIndex | null>;

  /** Persists the precomputed `normalized_name` / `phonetic_keys` fields for an entry. */
  updateIndexedFields(id: WatchlistEntryId, fields: WatchlistEntryIndexedFields): Promise<void>;

  /**
   * Cascade helper for `DeleteWatchlist` (design §3, RF-5): soft-deletes
   * every non-removed entry of a watchlist within the SAME transaction as
   * the watchlist delete. Minimal bulk op — NOT the full entry CRUD
   * (Slice B); only what the cascade needs.
   */
  softDeleteAllByWatchlist(watchlistId: WatchlistId, now: Instant, tx?: Transaction): Promise<void>;
}
