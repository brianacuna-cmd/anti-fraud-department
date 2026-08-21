import type { WatchlistEntryId } from '../model/value-objects/WatchlistEntryId.js';

/**
 * Write-path port for the `watchlist_entries` collection (spec NFI: single
 * shared normalizer used at write+read). `IndexWatchlistEntry` (application
 * layer) uses this to persist the precomputed `nombreNormalizado` and
 * `phoneticKeys` fields the blocking-layer indexes (`ensureIndexes.ts`)
 * query on. Read-path candidate lookup stays on `WatchlistCandidateRepository`
 * — this port is write-only and intentionally minimal.
 */
export interface WatchlistEntryIndexedFields {
  readonly nombreNormalizado: string;
  readonly phoneticKeys: readonly string[];
}

export interface WatchlistEntryToIndex {
  readonly id: WatchlistEntryId;
  readonly nombre: string;
}

export interface WatchlistEntryRepository {
  /** Fetches the minimal fields (id + raw nombre) needed to (re)compute indexed fields. */
  findToIndex(id: WatchlistEntryId): Promise<WatchlistEntryToIndex | null>;

  /** Persists the precomputed `nombre_normalizado` / `phonetic_keys` fields for an entry. */
  updateIndexedFields(id: WatchlistEntryId, fields: WatchlistEntryIndexedFields): Promise<void>;
}
