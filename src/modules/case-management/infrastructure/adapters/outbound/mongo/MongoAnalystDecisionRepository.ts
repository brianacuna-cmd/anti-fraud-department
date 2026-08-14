import { ObjectId, type ClientSession, type Collection, type Db } from 'mongodb';
import type { AnalystDecision } from '../../../../domain/model/aggregates/AnalystDecision.js';
import type { AnalystDecisionRepository } from '../../../../domain/ports/AnalystDecisionRepository.js';
import type { AnalystDecisionId } from '../../../../domain/model/value-objects/AnalystDecisionId.js';
import type { CaseId } from '../../../../domain/model/value-objects/CaseId.js';
import type { Transaction } from '../../../../domain/ports/UnitOfWork.js';
import type { AnalystDecisionDocument } from './documents/AnalystDecisionDocument.js';
import { toDocument, toDomain } from './mappers/AnalystDecisionDocumentMapper.js';

function toSession(tx: Transaction | undefined): ClientSession | undefined {
  return tx as unknown as ClientSession | undefined;
}

const COLLECTION_NAME = 'analyst_decisions';

export class MongoAnalystDecisionRepository implements AnalystDecisionRepository {
  private readonly collection: Collection<AnalystDecisionDocument>;

  constructor(db: Db) {
    this.collection = db.collection<AnalystDecisionDocument>(COLLECTION_NAME);
  }

  async save(decision: AnalystDecision, tx?: Transaction): Promise<void> {
    const document = toDocument(decision);
    await this.collection.replaceOne({ _id: document._id }, document, {
      upsert: true,
      session: toSession(tx),
    });
  }

  async findById(id: AnalystDecisionId, tx?: Transaction): Promise<AnalystDecision | null> {
    const document = await this.collection.findOne({ _id: new ObjectId(id) }, { session: toSession(tx) });
    return document ? toDomain(document) : null;
  }

  async findByCaseId(caseId: CaseId, tx?: Transaction): Promise<AnalystDecision[]> {
    const documents = await this.collection
      .find({ case_id: new ObjectId(caseId) }, { session: toSession(tx) })
      .sort({ created_at: -1 })
      .toArray();
    return documents.map(toDomain);
  }
}
