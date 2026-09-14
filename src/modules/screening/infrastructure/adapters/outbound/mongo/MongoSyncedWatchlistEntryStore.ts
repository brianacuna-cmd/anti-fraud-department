import type { AnyBulkWriteOperation, Collection, Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import type { Instant } from '../../../../../../shared/time/Instant.js';
import { toDate } from '../../../../../../shared/time/Instant.js';
import { createWatchlistEntryId } from '../../../../domain/model/value-objects/WatchlistEntryId.js';
import type { WatchlistId } from '../../../../domain/model/value-objects/WatchlistId.js';
import type {
  SyncedEntrySnapshot,
  SyncedEntryWrite,
  SyncedWatchlistEntryStore,
  WatchlistSyncChange,
} from '../../../../domain/ports/SyncedWatchlistEntryStore.js';
import type { WatchlistDocument } from './documents/WatchlistDocument.js';
import type { WatchlistEntryDocument } from './documents/WatchlistEntryDocument.js';

const ENTRIES_COLLECTION = 'watchlist_entries';
const WATCHLISTS_COLLECTION = 'watchlists';

/** Keeps each round trip well under Mongo's 16 MB command size, whatever the names look like. */
const BULK_BATCH_SIZE = 1000;

function syncedFields(change: WatchlistSyncChange, write: SyncedEntryWrite) {
  return {
    entry_type: write.record.entryType,
    name: write.record.name,
    normalized_name: write.indexed.normalizedName,
    phonetic_keys: [...write.indexed.phoneticKeys],
    document: write.record.document,
    wallet_address: write.record.walletAddress,
    risk_level: change.riskLevel,
    country: write.record.country,
    status: 'ACTIVE',
    deleted_at: null,
    updated_at: toDate(change.now),
    sync_fingerprint: write.fingerprint,
  };
}

function insertOperation(
  change: WatchlistSyncChange,
  write: SyncedEntryWrite,
): AnyBulkWriteOperation<WatchlistEntryDocument> {
  return {
    insertOne: {
      document: {
        _id: new ObjectId(write.id),
        watchlist_id: new ObjectId(change.watchlistId),
        organization_id: new ObjectId(change.organizationId),
        created_at: toDate(change.now),
        external_ref: write.record.externalRef,
        ...syncedFields(change, write),
      },
    },
  };
}

function updateOperation(
  change: WatchlistSyncChange,
  write: SyncedEntryWrite,
): AnyBulkWriteOperation<WatchlistEntryDocument> {
  return { updateOne: { filter: { _id: new ObjectId(write.id) }, update: { $set: syncedFields(change, write) } } };
}

/**
 * Bulk writer behind the sanctions sync (AML-001).
 *
 * Unlike `MongoWatchlistEntryRepository.create`, inserts carry their
 * `normalized_name` / `phonetic_keys` already computed, so a synced entry is
 * searchable the moment it is written instead of after a second update.
 * Removal is the same soft delete the rest of screening uses (`REMOVED` +
 * `deleted_at`), so the candidate query already ignores delisted parties.
 */
export class MongoSyncedWatchlistEntryStore implements SyncedWatchlistEntryStore {
  private readonly entries: Collection<WatchlistEntryDocument>;
  private readonly watchlists: Collection<WatchlistDocument>;

  constructor(db: Db) {
    this.entries = db.collection<WatchlistEntryDocument>(ENTRIES_COLLECTION);
    this.watchlists = db.collection<WatchlistDocument>(WATCHLISTS_COLLECTION);
  }

  async listSnapshots(watchlistId: WatchlistId): Promise<readonly SyncedEntrySnapshot[]> {
    const documents = await this.entries
      .find(
        { watchlist_id: new ObjectId(watchlistId), external_ref: { $exists: true } },
        { projection: { _id: 1, external_ref: 1, sync_fingerprint: 1, status: 1 } },
      )
      .toArray();
    return documents.map((document) => ({
      id: createWatchlistEntryId(document._id.toString()),
      externalRef: document.external_ref ?? '',
      fingerprint: document.sync_fingerprint ?? '',
      active: document.status === 'ACTIVE',
    }));
  }

  async apply(change: WatchlistSyncChange): Promise<void> {
    const now = toDate(change.now);
    const operations: AnyBulkWriteOperation<WatchlistEntryDocument>[] = [
      ...change.inserts.map((write) => insertOperation(change, write)),
      ...change.updates.map((write) => updateOperation(change, write)),
      ...change.removals.map(
        (id): AnyBulkWriteOperation<WatchlistEntryDocument> => ({
          updateOne: {
            filter: { _id: new ObjectId(id) },
            update: { $set: { status: 'REMOVED', deleted_at: now, updated_at: now } },
          },
        }),
      ),
    ];
    for (let start = 0; start < operations.length; start += BULK_BATCH_SIZE) {
      await this.entries.bulkWrite(operations.slice(start, start + BULK_BATCH_SIZE), { ordered: false });
    }
  }

  /**
   * A targeted `$set`, not a watchlist save: `updated_at` stays untouched, so
   * "last edited" and "last synced" remain two different facts.
   */
  async recordSync(watchlistId: WatchlistId, now: Instant): Promise<void> {
    await this.watchlists.updateOne({ _id: new ObjectId(watchlistId) }, { $set: { last_synced_at: toDate(now) } });
  }
}
