import { ObjectId, type ClientSession, type Collection, type Db } from 'mongodb';
import type { Case } from '../../../../domain/model/aggregates/Case.js';
import type { CaseListPage, CaseRepository } from '../../../../domain/ports/CaseRepository.js';
import type { CaseId } from '../../../../domain/model/value-objects/CaseId.js';
import type { Transaction } from '../../../../domain/ports/UnitOfWork.js';
import type { CaseDocument } from './documents/CaseDocument.js';
import { toDocument, toDomain } from './mappers/CaseDocumentMapper.js';

/** Casts the opaque `Transaction` handle back to a real Mongo `ClientSession` (mirrors identity-access). */
function toSession(tx: Transaction | undefined): ClientSession | undefined {
  return tx as unknown as ClientSession | undefined;
}

const COLLECTION_NAME = 'Cases';

/** Mongo adapter for `CaseRepository`. */
export class MongoCaseRepository implements CaseRepository {
  private readonly collection: Collection<CaseDocument>;

  constructor(db: Db) {
    this.collection = db.collection<CaseDocument>(COLLECTION_NAME);
  }

  async save(kase: Case, tx?: Transaction): Promise<void> {
    const document = toDocument(kase);
    await this.collection.replaceOne({ _id: document._id }, document, {
      upsert: true,
      session: toSession(tx),
    });
  }

  async findById(id: CaseId, tx?: Transaction): Promise<Case | null> {
    if (!ObjectId.isValid(id)) return null;
    const document = await this.collection.findOne({ _id: new ObjectId(id) }, { session: toSession(tx) });
    return document ? toDomain(document) : null;
  }

  async findByCustomerOrBridgeId(
    organizationId: string,
    customerId?: string | null,
    bridgeUserId?: string | null,
    tx?: Transaction,
  ): Promise<Case | null> {
    const conditions: Record<string, unknown>[] = [];
    if (customerId) {
      conditions.push({ CustomerId: customerId });
      conditions.push({ 'FinturuCacheSnapshot.idUser': customerId });
      conditions.push({ 'FinturuCacheSnapshot.idUser': Number(customerId) });
    }
    if (bridgeUserId) {
      conditions.push({ BridgeUserId: bridgeUserId });
      conditions.push({ 'FinturuCacheSnapshot.idUserBridge': bridgeUserId });
    }
    if (conditions.length === 0) return null;

    let document = await this.collection.findOne(
      {
        OrganizationId: organizationId,
        $or: conditions,
      },
      { session: toSession(tx) },
    );

    if (!document) {
      document = await this.collection.findOne(
        {
          $or: conditions,
        },
        { session: toSession(tx) },
      );
    }

    return document ? toDomain(document) : null;
  }

  async list(organizationId?: string | null, limit = 50, cursor?: string, status?: string): Promise<CaseListPage> {
    const filter: Record<string, unknown> = {};
    if (organizationId) {
      filter.OrganizationId = organizationId;
    }
    if (status && status !== 'ALL') {
      filter.Status = status;
    }
    if (cursor && ObjectId.isValid(cursor)) {
      filter._id = { $lt: new ObjectId(cursor) };
    }
    const documents = await this.collection.find(filter).sort({ _id: -1 }).limit(limit + 1).toArray();
    const items = documents.slice(0, limit).map(toDomain);
    const nextCursor = documents.length > limit ? documents[limit]._id.toString() : null;
    return { items, nextCursor };
  }
}
