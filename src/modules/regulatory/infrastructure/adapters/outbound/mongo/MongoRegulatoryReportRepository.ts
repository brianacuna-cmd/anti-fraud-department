import { ObjectId, type ClientSession, type Collection, type Db, type Filter } from 'mongodb';
import type { RegulatoryReport } from '../../../../domain/model/aggregates/RegulatoryReport.js';
import type { RegulatoryReportId } from '../../../../domain/model/value-objects/RegulatoryReportId.js';
import type {
  RegulatoryReportListQuery,
  RegulatoryReportListResult,
  RegulatoryReportRepository,
} from '../../../../domain/ports/RegulatoryReportRepository.js';
import type { Transaction } from '../../../../domain/ports/UnitOfWork.js';
import type { RegulatoryReportDocument } from './documents/RegulatoryReportDocument.js';
import { toDocument, toDomain } from './mappers/RegulatoryReportDocumentMapper.js';

function toSession(tx: Transaction | undefined): ClientSession | undefined {
  return tx as unknown as ClientSession | undefined;
}

const COLLECTION_NAME = 'regulatory_reports';

export class MongoRegulatoryReportRepository implements RegulatoryReportRepository {
  private readonly collection: Collection<RegulatoryReportDocument>;

  constructor(db: Db) {
    this.collection = db.collection<RegulatoryReportDocument>(COLLECTION_NAME);
  }

  async save(report: RegulatoryReport, tx?: Transaction): Promise<void> {
    const document = toDocument(report);
    await this.collection.replaceOne({ _id: document._id }, document, {
      upsert: true,
      session: toSession(tx),
    });
  }

  async findById(id: RegulatoryReportId, tx?: Transaction): Promise<RegulatoryReport | null> {
    const document = await this.collection.findOne(
      { _id: new ObjectId(id) },
      { session: toSession(tx) },
    );
    return document ? toDomain(document) : null;
  }

  async list(
    query: RegulatoryReportListQuery,
    tx?: Transaction,
  ): Promise<RegulatoryReportListResult> {
    const filter: Filter<RegulatoryReportDocument> = {
      organization_id: new ObjectId(query.organizationId),
      ...(query.status !== undefined && query.status.length > 0
        ? { status: { $in: [...query.status] } }
        : {}),
    } as Filter<RegulatoryReportDocument>;

    const session = toSession(tx);
    const total = await this.collection.countDocuments(filter, { session });
    const documents = await this.collection
      .find(filter, { session })
      // Por periodo y no por fecha de creación: quien busca "el reporte de
      // septiembre" piensa en el mes que cubre, no en cuándo se compiló.
      .sort({ period_end: -1 })
      .skip(query.offset)
      .limit(query.limit)
      .toArray();
    return { items: documents.map(toDomain), total };
  }
}
