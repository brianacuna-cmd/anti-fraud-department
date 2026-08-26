import type { ClientSession, Collection, Db, Filter } from 'mongodb';
import { ObjectId } from 'mongodb';
import { createWatchlistEntryId } from '../../../../domain/model/value-objects/WatchlistEntryId.js';
import type { WatchlistEntryId } from '../../../../domain/model/value-objects/WatchlistEntryId.js';
import type { WatchlistId } from '../../../../domain/model/value-objects/WatchlistId.js';
import type { Instant } from '../../../../../../shared/time/Instant.js';
import { toDate } from '../../../../../../shared/time/Instant.js';
import type { Transaction } from '../../../../domain/ports/UnitOfWork.js';
import type {
  WalletEntryDeltaQuery,
  WatchlistEntryIndexedFields,
  WatchlistEntryListQuery,
  WatchlistEntryListResult,
  WatchlistEntryRepository,
  WatchlistEntryToIndex,
} from '../../../../domain/ports/WatchlistEntryRepository.js';
import type { WatchlistEntry } from '../../../../domain/model/aggregates/WatchlistEntry.js';
import type { WatchlistEntryDocument } from './documents/WatchlistEntryDocument.js';
import { toDomain, toDocument } from './mappers/WatchlistEntryMapper.js';

function toSession(tx: Transaction | undefined): ClientSession | undefined {
  return tx as unknown as ClientSession | undefined;
}

const COLLECTION_NAME = 'watchlist_entries';

function statusFilterFragment(query: WatchlistEntryListQuery): Record<string, unknown> {
  return query.status !== undefined && query.status.length > 0 ? { status: { $in: [...query.status] } } : {};
}

function entryTypeFilterFragment(query: WatchlistEntryListQuery): Record<string, unknown> {
  return query.entryType !== undefined && query.entryType.length > 0
    ? { entry_type: { $in: [...query.entryType] } }
    : {};
}

function riskLevelFilterFragment(query: WatchlistEntryListQuery): Record<string, unknown> {
  return query.riskLevel !== undefined && query.riskLevel.length > 0
    ? { risk_level: { $in: [...query.riskLevel] } }
    : {};
}

function countryFilterFragment(query: WatchlistEntryListQuery): Record<string, unknown> {
  return query.country !== undefined ? { country: query.country } : {};
}

function listFilter(query: WatchlistEntryListQuery): Filter<WatchlistEntryDocument> {
  const filter: Record<string, unknown> = {
    watchlist_id: new ObjectId(query.watchlistId),
    organization_id: new ObjectId(query.organizationId),
    ...statusFilterFragment(query),
    ...entryTypeFilterFragment(query),
    ...riskLevelFilterFragment(query),
    ...countryFilterFragment(query),
  };
  return filter as Filter<WatchlistEntryDocument>;
}

/**
 * Write-path Mongo adapter for `WatchlistEntryRepository`. Backs
 * `IndexWatchlistEntry` (fetches minimal fields, persists indexed fields)
 * and the full Slice B CRUD operations (create/save/findById/list).
 * ADR-3: `findToIndex`/`updateIndexedFields` accept optional `tx` so
 * normalization can commit atomically with the entry write.
 */
export class MongoWatchlistEntryRepository implements WatchlistEntryRepository {
  private readonly collection: Collection<WatchlistEntryDocument>;

  constructor(db: Db) {
    this.collection = db.collection<WatchlistEntryDocument>(COLLECTION_NAME);
  }

  async findToIndex(id: WatchlistEntryId, tx?: Transaction): Promise<WatchlistEntryToIndex | null> {
    const document = await this.collection.findOne(
      { _id: new ObjectId(id) },
      { projection: { name: 1 }, session: toSession(tx) },
    );
    if (!document) {
      return null;
    }
    return { id: createWatchlistEntryId(document._id.toString()), name: document.name };
  }

  async updateIndexedFields(
    id: WatchlistEntryId,
    fields: WatchlistEntryIndexedFields,
    tx?: Transaction,
  ): Promise<void> {
    await this.collection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { normalized_name: fields.normalizedName, phonetic_keys: [...fields.phoneticKeys] } },
      { session: toSession(tx) },
    );
  }

  async softDeleteAllByWatchlist(watchlistId: WatchlistId, now: Instant, tx?: Transaction): Promise<void> {
    await this.collection.updateMany(
      { watchlist_id: new ObjectId(watchlistId), status: { $ne: 'REMOVED' } },
      { $set: { status: 'REMOVED', deleted_at: toDate(now) } },
      { session: toSession(tx) },
    );
  }

  async create(entry: WatchlistEntry, tx?: Transaction): Promise<void> {
    await this.collection.insertOne(toDocument(entry), { session: toSession(tx) });
  }

  async save(entry: WatchlistEntry, tx?: Transaction): Promise<void> {
    await this.collection.updateOne(
      { _id: new ObjectId(entry.id) },
      {
        $set: {
          watchlist_id: new ObjectId(entry.watchlistId),
          organization_id: new ObjectId(entry.organizationId),
          entry_type: entry.entryType,
          name: entry.name,
          document: entry.document,
          wallet_address: entry.walletAddress,
          risk_level: entry.riskLevel,
          country: entry.country,
          status: entry.status,
          deleted_at: entry.deletedAt ? toDate(entry.deletedAt) : null,
          updated_at: toDate(entry.updatedAt),
        },
      },
      { session: toSession(tx) },
    );
  }

  async findById(id: WatchlistEntryId, tx?: Transaction): Promise<WatchlistEntry | null> {
    const document = await this.collection.findOne(
      { _id: new ObjectId(id) },
      { session: toSession(tx) },
    );
    return document ? toDomain(document) : null;
  }

  async list(query: WatchlistEntryListQuery, tx?: Transaction): Promise<WatchlistEntryListResult> {
    const filter = listFilter(query);
    const session = toSession(tx);
    const total = await this.collection.countDocuments(filter, { session });
    const documents = await this.collection
      .find(filter, { session })
      .sort({ created_at: -1 })
      .skip(query.offset)
      .limit(query.limit)
      .toArray();
    return { items: documents.map(toDomain), total };
  }

  /**
   * Keyset delta scan — implemented in PR2 (`MongoWatchlistEntryRepository`
   * persistence slice). Stub preserved here so the port contract compiles
   * while PR1 (port contracts only) is in review.
   *
   * @throws Will be replaced by the real keyset cursor query in PR2.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async listActiveWalletEntriesUpdatedSince(_query: WalletEntryDeltaQuery, _tx?: Transaction): Promise<readonly WatchlistEntry[]> {
    throw new Error('listActiveWalletEntriesUpdatedSince: not yet implemented — see PR2');
  }
}
