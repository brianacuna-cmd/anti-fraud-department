import { ObjectId, type ClientSession, type Collection, type Db } from 'mongodb';
import type { NotificationOrgConfig } from '../../../../domain/model/aggregates/NotificationOrgConfig.js';
import type { NotificationOrgConfigRepository } from '../../../../domain/ports/NotificationOrgConfigRepository.js';
import type { OrganizationId } from '../../../../domain/model/value-objects/OrganizationId.js';
import type { Transaction } from '../../../../domain/ports/UnitOfWork.js';
import type { NotificationOrgConfigDocument } from './documents/NotificationOrgConfigDocument.js';
import { toDomain, toUpsertFields } from './mappers/NotificationOrgConfigDocumentMapper.js';

function toSession(tx: Transaction | undefined): ClientSession | undefined {
  return tx as unknown as ClientSession | undefined;
}

const COLLECTION_NAME = 'notification_org_config';

/**
 * Production `NotificationOrgConfigRepository` (design PR1). Collection
 * `notification_org_config`, unique index on `organization_id` (see
 * `ensureIndexes.ts`). `upsert` uses `findOneAndUpdate(..., { upsert: true })`
 * — the same "no separate read vs create branch" collapse as
 * `MongoNotificationPreferenceRepository`.
 */
export class MongoNotificationOrgConfigRepository implements NotificationOrgConfigRepository {
  private readonly collection: Collection<NotificationOrgConfigDocument>;

  constructor(db: Db) {
    this.collection = db.collection<NotificationOrgConfigDocument>(COLLECTION_NAME);
  }

  async upsert(config: NotificationOrgConfig, tx?: Transaction): Promise<void> {
    const { key, set, setOnInsert } = toUpsertFields(config);
    await this.collection.updateOne(
      key,
      { $set: set, $setOnInsert: setOnInsert },
      { upsert: true, session: toSession(tx) },
    );
  }

  async findByOrganization(organizationId: OrganizationId, tx?: Transaction): Promise<NotificationOrgConfig | null> {
    const document = await this.collection.findOne(
      { organization_id: new ObjectId(organizationId) },
      { session: toSession(tx) },
    );
    return document ? toDomain(document) : null;
  }
}
