import type { Instant } from '../../../../shared/time/Instant.js';
import type { EntryType } from '../model/value-objects/EntryType.js';
import type { RiskLevel } from '../model/value-objects/RiskLevel.js';
import type { WatchlistEntryId } from '../model/value-objects/WatchlistEntryId.js';
import type { WatchlistId } from '../model/value-objects/WatchlistId.js';
import type { WatchlistEntryIndexedFields } from './WatchlistEntryRepository.js';

/**
 * One watchlist entry derived from an official list. `externalRef` is stable
 * across downloads for the same name/document/wallet of the same party, which
 * is what lets a sync update an entry in place instead of replacing it — and
 * keeps its id, so AML alerts already raised against it stay attached.
 */
export interface SanctionListRecord {
  readonly externalRef: string;
  readonly entryType: EntryType;
  readonly name: string;
  readonly document: string | null;
  readonly walletAddress: string | null;
  readonly country: string | null;
}

/** What the store already holds for one synced entry — enough to diff, nothing more. */
export interface SyncedEntrySnapshot {
  readonly id: WatchlistEntryId;
  readonly externalRef: string;
  readonly fingerprint: string;
  /** False once a previous sync removed it (delisted); re-listing reactivates it. */
  readonly active: boolean;
}

export interface SyncedEntryWrite {
  readonly id: WatchlistEntryId;
  readonly record: SanctionListRecord;
  readonly fingerprint: string;
  readonly indexed: WatchlistEntryIndexedFields;
}

export interface WatchlistSyncChange {
  readonly watchlistId: WatchlistId;
  readonly organizationId: string;
  readonly riskLevel: RiskLevel;
  readonly inserts: readonly SyncedEntryWrite[];
  /** Also reactivates: an update always leaves the entry ACTIVE. */
  readonly updates: readonly SyncedEntryWrite[];
  readonly removals: readonly WatchlistEntryId[];
  readonly now: Instant;
}

/**
 * Write port for bulk list synchronization (AML-001).
 *
 * Separate from `WatchlistEntryRepository` on purpose: an official list is
 * tens of thousands of entries, and the one-aggregate-per-write path (with an
 * index round trip per entry, inside one transaction) would take minutes and
 * exceed Mongo's transaction limits. Writes here are batched and NOT
 * transactional; the sync is idempotent, so an interrupted run is repaired by
 * the next one rather than rolled back.
 */
export interface SyncedWatchlistEntryStore {
  listSnapshots(watchlistId: WatchlistId): Promise<readonly SyncedEntrySnapshot[]>;
  apply(change: WatchlistSyncChange): Promise<void>;
}
