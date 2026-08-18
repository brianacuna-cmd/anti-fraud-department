import { ObjectId, type ClientSession, type Collection, type Db } from 'mongodb';
import type { Investigation } from '../../../../domain/model/aggregates/Investigation.js';
import type { InvestigationRepository } from '../../../../domain/ports/InvestigationRepository.js';
import type { CaseId } from '../../../../domain/model/value-objects/CaseId.js';
import type { InvestigationId } from '../../../../domain/model/value-objects/InvestigationId.js';
import type { Transaction } from '../../../../domain/ports/UnitOfWork.js';
import type { InvestigationDocument } from './documents/InvestigationDocument.js';
import { toDocument, toDomain } from './mappers/InvestigationDocumentMapper.js';

function toSession(tx: Transaction | undefined): ClientSession | undefined {
  return tx as unknown as ClientSession | undefined;
}

const COLLECTION_NAME = 'investigations';

/** Mongo adapter for `InvestigationRepository`. `save` upserts (open then close). */
export class MongoInvestigationRepository implements InvestigationRepository {
  private readonly collection: Collection<InvestigationDocument>;

  constructor(db: Db) {
    this.collection = db.collection<InvestigationDocument>(COLLECTION_NAME);
  }

  async save(investigation: Investigation, tx?: Transaction): Promise<void> {
    const document = toDocument(investigation);
    await this.collection.replaceOne({ _id: document._id }, document, {
      upsert: true,
      session: toSession(tx),
    });
  }

  async findById(id: InvestigationId, tx?: Transaction): Promise<Investigation | null> {
    const document = await this.collection.findOne({ _id: new ObjectId(id) }, { session: toSession(tx) });
    return document ? toDomain(document) : null;
  }

  async listByCaseId(caseId: CaseId, tx?: Transaction): Promise<Investigation[]> {
    const documents = await this.collection
      .find({ case_id: new ObjectId(caseId) }, { session: toSession(tx) })
      .sort({ created_at: 1 })
      .toArray();
    return documents.map(toDomain);
  }
}
