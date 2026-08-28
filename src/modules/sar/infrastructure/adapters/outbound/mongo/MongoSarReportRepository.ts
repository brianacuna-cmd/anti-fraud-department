import { ObjectId, type ClientSession, type Collection, type Db } from 'mongodb';
import type { SarReport } from '../../../../domain/model/aggregates/SarReport.js';
import type { SarReportId } from '../../../../domain/model/value-objects/SarReportId.js';
import type { SarReportRepository } from '../../../../domain/ports/SarReportRepository.js';
import type { Transaction } from '../../../../domain/ports/UnitOfWork.js';
import type { SarReportDocument } from './documents/SarReportDocument.js';
import { toDocument, toDomain } from './mappers/SarReportDocumentMapper.js';

/** Casts the opaque `Transaction` handle back to a real Mongo `ClientSession` (mirrors sibling repositories). */
function toSession(tx: Transaction | undefined): ClientSession | undefined {
  return tx as unknown as ClientSession | undefined;
}

const COLLECTION_NAME = 'sar_reports';

export class MongoSarReportRepository implements SarReportRepository {
  private readonly collection: Collection<SarReportDocument>;

  constructor(db: Db) {
    this.collection = db.collection<SarReportDocument>(COLLECTION_NAME);
  }

  async save(report: SarReport, tx?: Transaction): Promise<void> {
    const document = toDocument(report);
    await this.collection.replaceOne({ _id: document._id }, document, {
      upsert: true,
      session: toSession(tx),
    });
  }

  async findById(id: SarReportId, tx?: Transaction): Promise<SarReport | null> {
    const document = await this.collection.findOne({ _id: new ObjectId(id) }, { session: toSession(tx) });
    return document ? toDomain(document) : null;
  }
}
