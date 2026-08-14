import { ObjectId, type ClientSession, type Collection, type Db } from 'mongodb';
import type { ApprovalRequest } from '../../../../domain/model/aggregates/ApprovalRequest.js';
import type { ApprovalRequestRepository } from '../../../../domain/ports/ApprovalRequestRepository.js';
import type { ApprovalRequestId } from '../../../../domain/model/value-objects/ApprovalRequestId.js';
import type { EnforcementActionId } from '../../../../domain/model/value-objects/EnforcementActionId.js';
import type { Transaction } from '../../../../domain/ports/UnitOfWork.js';
import type { ApprovalRequestDocument } from './documents/ApprovalRequestDocument.js';
import { toDocument, toDomain } from './mappers/ApprovalRequestDocumentMapper.js';

function toSession(tx: Transaction | undefined): ClientSession | undefined {
  return tx as unknown as ClientSession | undefined;
}

const COLLECTION_NAME = 'approval_requests';

export class MongoApprovalRequestRepository implements ApprovalRequestRepository {
  private readonly collection: Collection<ApprovalRequestDocument>;

  constructor(db: Db) {
    this.collection = db.collection<ApprovalRequestDocument>(COLLECTION_NAME);
  }

  async save(request: ApprovalRequest, tx?: Transaction): Promise<void> {
    const document = toDocument(request);
    await this.collection.replaceOne({ _id: document._id }, document, {
      upsert: true,
      session: toSession(tx),
    });
  }

  async findById(id: ApprovalRequestId, tx?: Transaction): Promise<ApprovalRequest | null> {
    const document = await this.collection.findOne({ _id: new ObjectId(id) }, { session: toSession(tx) });
    return document ? toDomain(document) : null;
  }

  async findByEnforcementActionId(
    enforcementActionId: EnforcementActionId,
    tx?: Transaction,
  ): Promise<ApprovalRequest | null> {
    const document = await this.collection.findOne(
      { enforcement_action_id: new ObjectId(enforcementActionId) },
      { session: toSession(tx) },
    );
    return document ? toDomain(document) : null;
  }
}
