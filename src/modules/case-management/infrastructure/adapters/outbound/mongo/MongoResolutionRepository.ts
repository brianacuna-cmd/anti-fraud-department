import { ObjectId, type ClientSession, type Collection, type Db } from 'mongodb';
import type { Resolution } from '../../../../domain/model/aggregates/Resolution.js';
import type { ResolutionRepository } from '../../../../domain/ports/ResolutionRepository.js';
import type { CaseId } from '../../../../domain/model/value-objects/CaseId.js';
import type { Transaction } from '../../../../domain/ports/UnitOfWork.js';
import type { ResolutionDocument } from './documents/ResolutionDocument.js';
import { toDocument, toDomain } from './mappers/ResolutionDocumentMapper.js';

function toSession(tx: Transaction | undefined): ClientSession | undefined {
  return tx as unknown as ClientSession | undefined;
}

const COLLECTION_NAME = 'resolutions';

/** Mongo adapter for `ResolutionRepository`. Append-only — `insertOne`, never update/delete. */
export class MongoResolutionRepository implements ResolutionRepository {
  private readonly collection: Collection<ResolutionDocument>;

  constructor(db: Db) {
    this.collection = db.collection<ResolutionDocument>(COLLECTION_NAME);
  }

  async save(resolution: Resolution, tx?: Transaction): Promise<void> {
    await this.collection.insertOne(toDocument(resolution), { session: toSession(tx) });
  }

  async listByCaseId(caseId: CaseId, tx?: Transaction): Promise<Resolution[]> {
    const documents = await this.collection
      .find({ case_id: new ObjectId(caseId) }, { session: toSession(tx) })
      .sort({ created_at: 1 })
      .toArray();
    return documents.map(toDomain);
  }
}
