import { ObjectId, type ClientSession, type Collection, type Db } from 'mongodb';
import type { FraudDepartmentMetrics } from '../../../../domain/model/aggregates/FraudDepartmentMetrics.js';
import type { FraudDepartmentMetricsRepository } from '../../../../domain/ports/FraudDepartmentMetricsRepository.js';
import type { Transaction } from '../../../../domain/ports/UnitOfWork.js';
import type { FraudDepartmentMetricsDocument } from './documents/FraudDepartmentMetricsDocument.js';
import { toDomain, toUpsertFields } from './mappers/FraudDepartmentMetricsDocumentMapper.js';

function toSession(tx: Transaction | undefined): ClientSession | undefined {
  return tx as unknown as ClientSession | undefined;
}

const COLLECTION_NAME = 'fraud_department_metrics';

export class MongoFraudDepartmentMetricsRepository implements FraudDepartmentMetricsRepository {
  private readonly collection: Collection<FraudDepartmentMetricsDocument>;

  constructor(db: Db) {
    this.collection = db.collection<FraudDepartmentMetricsDocument>(COLLECTION_NAME);
  }

  async upsert(metrics: FraudDepartmentMetrics, tx?: Transaction): Promise<void> {
    const { key, set, setOnInsert } = toUpsertFields(metrics);
    await this.collection.findOneAndUpdate(
      key,
      { $set: set, $setOnInsert: setOnInsert },
      { upsert: true, session: toSession(tx) },
    );
  }

  async findByOrgAndDate(
    organizationId: string,
    fecha: string,
    tx?: Transaction,
  ): Promise<FraudDepartmentMetrics | null> {
    const document = await this.collection.findOne(
      { organization_id: new ObjectId(organizationId), fecha },
      { session: toSession(tx) },
    );
    return document ? toDomain(document) : null;
  }
}
