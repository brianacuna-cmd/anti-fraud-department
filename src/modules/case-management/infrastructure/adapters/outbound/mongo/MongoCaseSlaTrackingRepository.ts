import { ObjectId, type ClientSession, type Collection, type Db } from 'mongodb';
import { toDate, type Instant } from '../../../../../../shared/time/Instant.js';
import type { CaseSlaTracking } from '../../../../domain/model/aggregates/CaseSlaTracking.js';
import type { CaseSlaTrackingRepository } from '../../../../domain/ports/CaseSlaTrackingRepository.js';
import type { CaseId } from '../../../../domain/model/value-objects/CaseId.js';
import type { Transaction } from '../../../../domain/ports/UnitOfWork.js';
import type { CaseSlaTrackingDocument } from './documents/CaseSlaTrackingDocument.js';
import { toDocument, toDomain } from './mappers/CaseSlaTrackingDocumentMapper.js';

function toSession(tx: Transaction | undefined): ClientSession | undefined {
  return tx as unknown as ClientSession | undefined;
}

const COLLECTION_NAME = 'case_sla_tracking';

export class MongoCaseSlaTrackingRepository implements CaseSlaTrackingRepository {
  private readonly collection: Collection<CaseSlaTrackingDocument>;

  constructor(db: Db) {
    this.collection = db.collection<CaseSlaTrackingDocument>(COLLECTION_NAME);
  }

  async save(tracking: CaseSlaTracking, tx?: Transaction): Promise<void> {
    const document = toDocument(tracking);
    await this.collection.replaceOne({ _id: document._id }, document, {
      upsert: true,
      session: toSession(tx),
    });
  }

  async findByCaseId(caseId: CaseId, tx?: Transaction): Promise<CaseSlaTracking | null> {
    const document = await this.collection.findOne({ case_id: new ObjectId(caseId) }, { session: toSession(tx) });
    return document ? toDomain(document) : null;
  }

  async findDueForSweep(now: Instant, tx?: Transaction): Promise<CaseSlaTracking[]> {
    const documents = await this.collection
      .find(
        { due_date: { $lte: toDate(now) }, status: { $ne: 'BREACHED' } },
        { session: toSession(tx) },
      )
      .toArray();
    return documents.map(toDomain);
  }
}
