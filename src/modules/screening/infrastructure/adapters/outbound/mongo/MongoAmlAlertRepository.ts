import type { ClientSession, Collection, Db, Filter } from 'mongodb';
import { ObjectId } from 'mongodb';
import type { AmlAlert } from '../../../../domain/model/aggregates/AmlAlert.js';
import type { AmlAlertId } from '../../../../domain/model/value-objects/AmlAlertId.js';
import type {
  AmlAlertListQuery,
  AmlAlertListResult,
  AmlAlertNaturalKey,
  AmlAlertRepository,
} from '../../../../domain/ports/AmlAlertRepository.js';
import type { Transaction } from '../../../../domain/ports/UnitOfWork.js';
import { isDuplicateKeyError } from '../../../../../../shared/persistence/mongo/duplicateKey.js';
import type { AmlAlertDocument } from './documents/AmlAlertDocument.js';
import { toDocument, toDomain } from './mappers/AmlAlertDocumentMapper.js';

const COLLECTION_NAME = 'aml_alerts';

function toSession(tx: Transaction | undefined): ClientSession | undefined {
  return tx as unknown as ClientSession | undefined;
}

function naturalKeyQuery(key: AmlAlertNaturalKey): Filter<AmlAlertDocument> {
  return {
    organization_id: new ObjectId(key.organizationId),
    customer_id: key.customerId,
    'matched_entry.entry_id': new ObjectId(key.entryId),
    'matched_entry.match_field': key.matchField,
  };
}

function listFilter(query: AmlAlertListQuery): Filter<AmlAlertDocument> {
  const filter: Filter<AmlAlertDocument> = {
    organization_id: new ObjectId(query.organizationId),
  };
  if (query.estado !== undefined && query.estado.length > 0) {
    return { ...filter, estado: { $in: [...query.estado] } };
  }
  return filter;
}

/**
 * Mongo adapter for `AmlAlertRepository`. Updates replace by `_id` so
 * triage transitions persist. Creates `insertOne`; a natural-key hit
 * returns `'duplicate'` without writing (RF-6, and so a Mongo transaction
 * is not aborted by E11000). A concurrent insert race still swallows
 * E11000 as `'duplicate'`.
 */
export class MongoAmlAlertRepository implements AmlAlertRepository {
  private readonly collection: Collection<AmlAlertDocument>;

  constructor(db: Db) {
    this.collection = db.collection<AmlAlertDocument>(COLLECTION_NAME);
  }

  async save(alert: AmlAlert, tx?: Transaction): Promise<'inserted' | 'updated' | 'duplicate'> {
    const document = toDocument(alert);
    const session = toSession(tx);
    const existingById = await this.collection.findOne({ _id: document._id }, { session });
    if (existingById) {
      await this.collection.replaceOne({ _id: document._id }, document, { session });
      return 'updated';
    }
    const existingByKey = await this.collection.findOne(
      naturalKeyQuery({
        organizationId: alert.organizationId,
        customerId: alert.customerId,
        entryId: String(alert.matchedEntry.entryId),
        matchField: alert.matchedEntry.matchField,
      }),
      { session },
    );
    if (existingByKey) {
      return 'duplicate';
    }
    try {
      await this.collection.insertOne(document, { session });
      return 'inserted';
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        return 'duplicate';
      }
      throw error;
    }
  }

  async findById(id: AmlAlertId, tx?: Transaction): Promise<AmlAlert | null> {
    const document = await this.collection.findOne(
      { _id: new ObjectId(id) },
      { session: toSession(tx) },
    );
    return document ? toDomain(document) : null;
  }

  async findByNaturalKey(key: AmlAlertNaturalKey, tx?: Transaction): Promise<AmlAlert | null> {
    const document = await this.collection.findOne(naturalKeyQuery(key), {
      session: toSession(tx),
    });
    return document ? toDomain(document) : null;
  }

  async list(query: AmlAlertListQuery, tx?: Transaction): Promise<AmlAlertListResult> {
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
