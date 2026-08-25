import type { ClientSession, Collection, Db, Filter } from 'mongodb';
import { ObjectId } from 'mongodb';
import type { Watchlist } from '../../../../domain/model/aggregates/Watchlist.js';
import type { WatchlistId } from '../../../../domain/model/value-objects/WatchlistId.js';
import type {
  WatchlistListQuery,
  WatchlistListResult,
  WatchlistRepository,
} from '../../../../domain/ports/WatchlistRepository.js';
import type { Transaction } from '../../../../domain/ports/UnitOfWork.js';
import type { WatchlistDocument } from './documents/WatchlistDocument.js';
import { toDocument, toDomain } from './mappers/WatchlistDocumentMapper.js';

const COLLECTION_NAME = 'watchlists';

function toSession(tx: Transaction | undefined): ClientSession | undefined {
  return tx as unknown as ClientSession | undefined;
}

function statusFilterFragment(query: WatchlistListQuery): Record<string, unknown> {
  return query.status !== undefined && query.status.length > 0 ? { status: { $in: [...query.status] } } : {};
}

function typeFilterFragment(query: WatchlistListQuery): Record<string, unknown> {
  return query.type !== undefined && query.type.length > 0 ? { type: { $in: [...query.type] } } : {};
}

function listFilter(query: WatchlistListQuery): Filter<WatchlistDocument> {
  const filter: Record<string, unknown> = {
    organization_id: new ObjectId(query.organizationId),
    ...statusFilterFragment(query),
    ...typeFilterFragment(query),
  };
  return filter as Filter<WatchlistDocument>;
}

/** Mongo adapter for `WatchlistRepository`. */
export class MongoWatchlistRepository implements WatchlistRepository {
  private readonly collection: Collection<WatchlistDocument>;

  constructor(db: Db) {
    this.collection = db.collection<WatchlistDocument>(COLLECTION_NAME);
  }

  async create(watchlist: Watchlist, tx?: Transaction): Promise<void> {
    await this.collection.insertOne(toDocument(watchlist), { session: toSession(tx) });
  }

  async save(watchlist: Watchlist, tx?: Transaction): Promise<void> {
    const document = toDocument(watchlist);
    await this.collection.replaceOne({ _id: document._id }, document, { session: toSession(tx) });
  }

  async findById(id: WatchlistId, tx?: Transaction): Promise<Watchlist | null> {
    const document = await this.collection.findOne({ _id: new ObjectId(id) }, { session: toSession(tx) });
    return document ? toDomain(document) : null;
  }

  async findByNameForOrg(organizationId: string, name: string, tx?: Transaction): Promise<Watchlist | null> {
    const document = await this.collection.findOne(
      { organization_id: new ObjectId(organizationId), name, deleted_at: null },
      { session: toSession(tx) },
    );
    return document ? toDomain(document) : null;
  }

  async list(query: WatchlistListQuery, tx?: Transaction): Promise<WatchlistListResult> {
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
}
