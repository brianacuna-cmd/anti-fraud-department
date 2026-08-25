import type { WatchlistEntryId } from '../model/value-objects/WatchlistEntryId.js';

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
}
