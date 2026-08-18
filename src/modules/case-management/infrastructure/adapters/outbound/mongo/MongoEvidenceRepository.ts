import { ObjectId, type ClientSession, type Collection, type Db } from 'mongodb';
import type { Evidence } from '../../../../domain/model/aggregates/Evidence.js';
import type { EvidenceRepository } from '../../../../domain/ports/EvidenceRepository.js';
import type { CaseId } from '../../../../domain/model/value-objects/CaseId.js';
import type { EvidenceId } from '../../../../domain/model/value-objects/EvidenceId.js';
import type { Transaction } from '../../../../domain/ports/UnitOfWork.js';
import type { EvidenceDocument } from './documents/EvidenceDocument.js';
import { toDocument, toDomain } from './mappers/EvidenceDocumentMapper.js';

function toSession(tx: Transaction | undefined): ClientSession | undefined {
  return tx as unknown as ClientSession | undefined;
}

const COLLECTION_NAME = 'evidence';

/** Mongo adapter for `EvidenceRepository` (metadata only). Append-only — `insertOne`. */
export class MongoEvidenceRepository implements EvidenceRepository {
  private readonly collection: Collection<EvidenceDocument>;

  constructor(db: Db) {
    this.collection = db.collection<EvidenceDocument>(COLLECTION_NAME);
  }

  async save(evidence: Evidence, tx?: Transaction): Promise<void> {
    await this.collection.insertOne(toDocument(evidence), { session: toSession(tx) });
  }

  async findById(id: EvidenceId, tx?: Transaction): Promise<Evidence | null> {
    const document = await this.collection.findOne({ _id: new ObjectId(id) }, { session: toSession(tx) });
    return document ? toDomain(document) : null;
  }

  async listByCaseId(caseId: CaseId, tx?: Transaction): Promise<Evidence[]> {
    const documents = await this.collection
      .find({ case_id: new ObjectId(caseId) }, { session: toSession(tx) })
      .sort({ created_at: -1 })
      .toArray();
    return documents.map(toDomain);
  }
}
