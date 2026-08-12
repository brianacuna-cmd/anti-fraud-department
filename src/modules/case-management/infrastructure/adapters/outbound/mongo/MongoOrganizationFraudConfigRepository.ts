import type { ClientSession, Collection, Db } from 'mongodb';
import type { OrganizationFraudConfig } from '../../../../domain/model/aggregates/OrganizationFraudConfig.js';
import type { OrganizationFraudConfigRepository } from '../../../../domain/ports/OrganizationFraudConfigRepository.js';
import type { Transaction } from '../../../../domain/ports/UnitOfWork.js';
import type { OrganizationFraudConfigDocument } from './documents/OrganizationFraudConfigDocument.js';
import { toDomain, toUpsertFields } from './mappers/OrganizationFraudConfigDocumentMapper.js';

/** Casts the opaque `Transaction` handle back to a real Mongo `ClientSession` (mirrors identity-access/notifications). */
function toSession(tx: Transaction | undefined): ClientSession | undefined {
  return tx as unknown as ClientSession | undefined;
}

const COLLECTION_NAME = 'OrganizationFraudConfig';

/**
 * Mongo adapter for `OrganizationFraudConfigRepository`. `upsert` is a single
 * atomic `findOneAndUpdate` keyed by `OrganizationId` (design: "per-tenant
 * singleton") — the singleton invariant is ultimately enforced by the
 * `org_fraud_config_unique` index, this call is just the idempotent write
 * path (mirrors `MongoNotificationPreferenceRepository.upsert`).
 */
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
      { OrganizationId: organizationId },
      { session: toSession(tx) },
    );
    return document ? toDomain(document) : null;
  }
}
