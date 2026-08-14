import { ObjectId, type ClientSession, type Collection, type Db } from 'mongodb';
import type { EnforcementAction } from '../../../../domain/model/aggregates/EnforcementAction.js';
import type { EnforcementActionRepository } from '../../../../domain/ports/EnforcementActionRepository.js';
import type { EnforcementActionId } from '../../../../domain/model/value-objects/EnforcementActionId.js';
import type { CaseId } from '../../../../domain/model/value-objects/CaseId.js';
import type { Transaction } from '../../../../domain/ports/UnitOfWork.js';
import type { EnforcementActionDocument } from './documents/EnforcementActionDocument.js';
import { toDocument, toDomain } from './mappers/EnforcementActionDocumentMapper.js';

function toSession(tx: Transaction | undefined): ClientSession | undefined {
  return tx as unknown as ClientSession | undefined;
}

const COLLECTION_NAME = 'enforcement_actions';

export class MongoEnforcementActionRepository implements EnforcementActionRepository {
  private readonly collection: Collection<EnforcementActionDocument>;

  constructor(db: Db) {
    this.collection = db.collection<EnforcementActionDocument>(COLLECTION_NAME);
  }

  async save(action: EnforcementAction, tx?: Transaction): Promise<void> {
    const document = toDocument(action);
    await this.collection.replaceOne({ _id: document._id }, document, {
      upsert: true,
      session: toSession(tx),
    });
  }

  async findById(id: EnforcementActionId, tx?: Transaction): Promise<EnforcementAction | null> {
    const document = await this.collection.findOne({ _id: new ObjectId(id) }, { session: toSession(tx) });
    return document ? toDomain(document) : null;
  }

  async findByCaseId(caseId: CaseId, tx?: Transaction): Promise<EnforcementAction[]> {
    const documents = await this.collection
      .find({ case_id: new ObjectId(caseId) }, { session: toSession(tx) })
      .toArray();
    return documents.map(toDomain);
  }
}
