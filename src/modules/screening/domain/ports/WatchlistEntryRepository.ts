import type { WatchlistEntry } from '../model/aggregates/WatchlistEntry.js';
import type { WatchlistEntryId } from '../model/value-objects/WatchlistEntryId.js';
import type { WatchlistEntryStatus } from '../model/value-objects/WatchlistEntryStatus.js';
import type { RiskLevel } from '../model/value-objects/RiskLevel.js';
import type { EntryType } from '../model/value-objects/EntryType.js';
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

export interface WatchlistEntryListQuery {
  readonly watchlistId: WatchlistId;
  readonly organizationId: string;
  readonly status?: readonly WatchlistEntryStatus[];
  readonly entryType?: readonly EntryType[];
  readonly riskLevel?: readonly RiskLevel[];
  readonly country?: string;
  readonly limit: number;
  readonly offset: number;
}

export interface WatchlistEntryListResult {
  readonly items: readonly WatchlistEntry[];
  readonly total: number;
}

/**
 * Keyset-cursor query for the wallet-rescreen delta scan (D1, D3).
 *
 * Two-step resolution: the use case first resolves BLACKLIST watchlist ids via
 * `WatchlistRepository.list`, then passes those ids here so the adapter can
 * filter on the `watchlist_entries_org_type_status_updated_idx` compound index
 * without a `$lookup`.
 *
 * `updatedSince: null` triggers a full backfill from epoch (WALLET_RESCREEN_BACKFILL=true).
 * `after` enables keyset pagination on `(updatedAt, id)` ASC — stable under
 * concurrent writes, unlike skip/offset (D3).
 */
export interface WalletEntryDeltaQuery {
  readonly organizationId: string;
  readonly watchlistIds: readonly WatchlistId[];
  /** Include only entries updated strictly after this timestamp. `null` = epoch (full backfill). */
  readonly updatedSince: Instant | null;
  readonly limit: number;
  readonly after?: { readonly updatedAt: Instant; readonly id: WatchlistEntryId };
}

export interface WatchlistEntryRepository {
  /** Fetches the minimal fields (id + raw name) needed to (re)compute indexed fields. */
  findToIndex(id: WatchlistEntryId, tx?: Transaction): Promise<WatchlistEntryToIndex | null>;

  /** Persists the precomputed `normalized_name` / `phonetic_keys` fields for an entry. */
  updateIndexedFields(id: WatchlistEntryId, fields: WatchlistEntryIndexedFields, tx?: Transaction): Promise<void>;

  /**
   * Cascade helper for `DeleteWatchlist` (design §3, RF-5): soft-deletes
   * every non-removed entry of a watchlist within the SAME transaction as
   * the watchlist delete. Minimal bulk op — NOT the full entry CRUD
   * (Slice B); only what the cascade needs.
   */
  softDeleteAllByWatchlist(watchlistId: WatchlistId, now: Instant, tx?: Transaction): Promise<void>;

  /** Slice B: full CRUD write methods. */
  create(entry: WatchlistEntry, tx?: Transaction): Promise<void>;
  save(entry: WatchlistEntry, tx?: Transaction): Promise<void>;
  findById(id: WatchlistEntryId, tx?: Transaction): Promise<WatchlistEntry | null>;
  list(query: WatchlistEntryListQuery, tx?: Transaction): Promise<WatchlistEntryListResult>;

  /**
   * Wallet-rescreen delta scan (R3, R6): returns ACTIVE WALLET entries whose
   * `updated_at` is strictly greater than `query.updatedSince` (or all entries
   * when `updatedSince` is `null`), scoped to `query.watchlistIds`.
   * Results are sorted ASC by `(updatedAt, id)` for stable keyset pagination.
   */
  listActiveWalletEntriesUpdatedSince(query: WalletEntryDeltaQuery, tx?: Transaction): Promise<readonly WatchlistEntry[]>;
}
