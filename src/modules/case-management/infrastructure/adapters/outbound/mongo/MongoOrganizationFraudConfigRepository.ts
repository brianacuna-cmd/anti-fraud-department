import { ObjectId, type ClientSession, type Collection, type Db } from 'mongodb';
import type { OrganizationFraudConfig } from '../../../../domain/model/aggregates/OrganizationFraudConfig.js';
import type { OrganizationFraudConfigRepository } from '../../../../domain/ports/OrganizationFraudConfigRepository.js';
import type { Transaction } from '../../../../domain/ports/UnitOfWork.js';
import type { OrganizationFraudConfigDocument } from './documents/OrganizationFraudConfigDocument.js';
import { toDomain, toUpsertFields } from './mappers/OrganizationFraudConfigDocumentMapper.js';

function toSession(tx: Transaction | undefined): ClientSession | undefined {
  return tx as unknown as ClientSession | undefined;
}

const COLLECTION_NAME = 'organization_fraud_config';

export class MongoOrganizationFraudConfigRepository implements OrganizationFraudConfigRepository {
  private readonly collection: Collection<OrganizationFraudConfigDocument>;

  constructor(db: Db) {
    this.collection = db.collection<OrganizationFraudConfigDocument>(COLLECTION_NAME);
  }

  async upsert(config: OrganizationFraudConfig, tx?: Transaction): Promise<void> {
    const { key, set, setOnInsert } = toUpsertFields(config);
    await this.collection.findOneAndUpdate(
      key,
      { $set: set, $setOnInsert: setOnInsert },
      { upsert: true, session: toSession(tx) },
    );
  }

  async findByOrganization(organizationId: string, tx?: Transaction): Promise<OrganizationFraudConfig | null> {
    const document = await this.collection.findOne(
      { organization_id: new ObjectId(organizationId) },
      { session: toSession(tx) },
    );
    return document ? toDomain(document) : null;
  }
}
