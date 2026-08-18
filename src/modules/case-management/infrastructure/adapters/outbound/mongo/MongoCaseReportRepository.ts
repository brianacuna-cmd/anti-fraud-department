import { ObjectId, type ClientSession, type Collection, type Db } from 'mongodb';
import type { CaseReport } from '../../../../domain/model/aggregates/CaseReport.js';
import type { CaseReportRepository } from '../../../../domain/ports/CaseReportRepository.js';
import type { CaseId } from '../../../../domain/model/value-objects/CaseId.js';
import type { CaseReportId } from '../../../../domain/model/value-objects/CaseReportId.js';
import type { Transaction } from '../../../../domain/ports/UnitOfWork.js';
import type { CaseReportDocument } from './documents/CaseReportDocument.js';
import { toDocument, toDomain } from './mappers/CaseReportDocumentMapper.js';

function toSession(tx: Transaction | undefined): ClientSession | undefined {
  return tx as unknown as ClientSession | undefined;
}

const COLLECTION_NAME = 'case_reports';

/** Mongo adapter for `CaseReportRepository`. Append-only — `insertOne`, never update/delete. */
export class MongoCaseReportRepository implements CaseReportRepository {
  private readonly collection: Collection<CaseReportDocument>;

  constructor(db: Db) {
    this.collection = db.collection<CaseReportDocument>(COLLECTION_NAME);
  }

  async save(report: CaseReport, tx?: Transaction): Promise<void> {
    await this.collection.insertOne(toDocument(report), { session: toSession(tx) });
  }

  async findById(id: CaseReportId, tx?: Transaction): Promise<CaseReport | null> {
    const document = await this.collection.findOne({ _id: new ObjectId(id) }, { session: toSession(tx) });
    return document ? toDomain(document) : null;
  }

  async listByCaseId(caseId: CaseId, tx?: Transaction): Promise<CaseReport[]> {
    const documents = await this.collection
      .find({ case_id: new ObjectId(caseId) }, { session: toSession(tx) })
      .sort({ created_at: -1 })
      .toArray();
    return documents.map(toDomain);
  }
}
