import type { ClientSession, Collection, Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import { createWatchlistEntryId } from '../../../../domain/model/value-objects/WatchlistEntryId.js';
import type { WatchlistEntryId } from '../../../../domain/model/value-objects/WatchlistEntryId.js';
import type { WatchlistId } from '../../../../domain/model/value-objects/WatchlistId.js';
import type { Instant } from '../../../../../../shared/time/Instant.js';
import { toDate } from '../../../../../../shared/time/Instant.js';
import type { Transaction } from '../../../../domain/ports/UnitOfWork.js';
import type {
  WatchlistEntryIndexedFields,
  WatchlistEntryRepository,
  WatchlistEntryToIndex,
} from '../../../../domain/ports/WatchlistEntryRepository.js';
import type { WatchlistEntryDocument } from './documents/WatchlistEntryDocument.js';

function toSession(tx: Transaction | undefined): ClientSession | undefined {
  return tx as unknown as ClientSession | undefined;
}

const COLLECTION_NAME = 'watchlist_entries';

/**
 * Write-path Mongo adapter for `WatchlistEntryRepository`. Backs
 * `IndexWatchlistEntry`: fetches the minimal fields to (re)compute the
 * normalized/phonetic indexed fields, then persists them onto the same
 * document the blocking-layer indexes (`ensureIndexes.ts`) query.
 */
export class MongoWatchlistEntryRepository implements WatchlistEntryRepository {
  private readonly collection: Collection<WatchlistEntryDocument>;

  constructor(db: Db) {
    this.collection = db.collection<WatchlistEntryDocument>(COLLECTION_NAME);
  }

  async findToIndex(id: WatchlistEntryId): Promise<WatchlistEntryToIndex | null> {
    const document = await this.collection.findOne(
      { _id: new ObjectId(id) },
      { projection: { name: 1 } },
    );
    if (!document) {
      return null;
    }
    return { id: createWatchlistEntryId(document._id.toString()), name: document.name };
  }

  async updateIndexedFields(id: WatchlistEntryId, fields: WatchlistEntryIndexedFields): Promise<void> {
    await this.collection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { normalized_name: fields.normalizedName, phonetic_keys: [...fields.phoneticKeys] } },
    );
  }

  async softDeleteAllByWatchlist(watchlistId: WatchlistId, now: Instant, tx?: Transaction): Promise<void> {
    await this.collection.updateMany(
      { watchlist_id: new ObjectId(watchlistId), status: { $ne: 'REMOVED' } },
      { $set: { status: 'REMOVED', deleted_at: toDate(now) } },
      { session: toSession(tx) },
    );
  }
}
