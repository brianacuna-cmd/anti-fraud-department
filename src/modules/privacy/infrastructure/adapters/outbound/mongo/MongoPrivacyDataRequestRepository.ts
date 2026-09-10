import { ObjectId, type ClientSession, type Collection, type Db, type Filter } from 'mongodb';
import type { PrivacyDataRequest } from '../../../../domain/model/aggregates/PrivacyDataRequest.js';
import type { PrivacyDataRequestId } from '../../../../domain/model/value-objects/PrivacyDataRequestId.js';
import type {
  PrivacyDataRequestListQuery,
  PrivacyDataRequestListResult,
  PrivacyDataRequestRepository,
} from '../../../../domain/ports/PrivacyDataRequestRepository.js';
import type { Transaction } from '../../../../domain/ports/UnitOfWork.js';
import type { PrivacyDataRequestDocument } from './documents/PrivacyDataRequestDocument.js';
import { toDocument, toDomain } from './mappers/PrivacyDataRequestDocumentMapper.js';

/** Casts the opaque `Transaction` handle back to a real Mongo `ClientSession` (mirrors sibling repositories). */
function toSession(tx: Transaction | undefined): ClientSession | undefined {
  return tx as unknown as ClientSession | undefined;
}

const COLLECTION_NAME = 'privacy_data_requests';

export class MongoPrivacyDataRequestRepository implements PrivacyDataRequestRepository {
  private readonly collection: Collection<PrivacyDataRequestDocument>;

  constructor(db: Db) {
    this.collection = db.collection<PrivacyDataRequestDocument>(COLLECTION_NAME);
  }

  async save(request: PrivacyDataRequest, tx?: Transaction): Promise<void> {
    const document = toDocument(request);
    await this.collection.replaceOne({ _id: document._id }, document, {
      upsert: true,
      session: toSession(tx),
    });
  }

  async findById(id: PrivacyDataRequestId, tx?: Transaction): Promise<PrivacyDataRequest | null> {
    const document = await this.collection.findOne(
      { _id: new ObjectId(id) },
      { session: toSession(tx) },
    );
    return document ? toDomain(document) : null;
  }

  async list(
    query: PrivacyDataRequestListQuery,
    tx?: Transaction,
  ): Promise<PrivacyDataRequestListResult> {
    const filter: Filter<PrivacyDataRequestDocument> = {
      organization_id: new ObjectId(query.organizationId),
      ...(query.status !== undefined && query.status.length > 0
        ? { status: { $in: [...query.status] } }
        : {}),
      ...(query.type !== undefined && query.type.length > 0
        ? { type: { $in: [...query.type] } }
        : {}),
    } as Filter<PrivacyDataRequestDocument>;

    const session = toSession(tx);
    const total = await this.collection.countDocuments(filter, { session });
    const documents = await this.collection
      .find(filter, { session })
      // By deadline, not by arrival: the queue exists to stop requests going
      // overdue, so the one closest to breaching has to surface first.
      .sort({ due_at: 1 })
      .skip(query.offset)
      .limit(query.limit)
      .toArray();
    return { items: documents.map(toDomain), total };
  }
}
