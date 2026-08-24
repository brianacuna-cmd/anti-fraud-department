import { ObjectId, type Collection, type Db } from 'mongodb';
import type { OrganizationScreeningConfig } from '../../../../domain/model/aggregates/OrganizationScreeningConfig.js';
import type { OrganizationScreeningConfigRepository } from '../../../../domain/ports/OrganizationScreeningConfigRepository.js';
import type { OrganizationScreeningConfigDocument } from './documents/OrganizationScreeningConfigDocument.js';
import { toDomain, toUpsertFields } from './mappers/OrganizationScreeningConfigDocumentMapper.js';

const COLLECTION_NAME = 'organization_screening_config';

/**
 * Mongo adapter for `OrganizationScreeningConfigRepository` (design D-6).
 * `findByOrganization` returns `null` when no row exists — unlike
 * `MongoOrganizationFraudConfigRepository`, absence is NOT an error here;
 * `GetOrganizationScreeningConfig` decides the default fallback (RF-6).
 */
export class MongoOrganizationScreeningConfigRepository implements OrganizationScreeningConfigRepository {
  private readonly collection: Collection<OrganizationScreeningConfigDocument>;

  constructor(db: Db) {
    this.collection = db.collection<OrganizationScreeningConfigDocument>(COLLECTION_NAME);
  }

  async upsert(config: OrganizationScreeningConfig): Promise<void> {
    const { key, set, setOnInsert } = toUpsertFields(config);
    await this.collection.findOneAndUpdate(
      key,
      { $set: set, $setOnInsert: setOnInsert },
      { upsert: true },
    );
  }

  async findByOrganization(organizationId: string): Promise<OrganizationScreeningConfig | null> {
    const document = await this.collection.findOne({ organization_id: new ObjectId(organizationId) });
    return document ? toDomain(document) : null;
  }
}
