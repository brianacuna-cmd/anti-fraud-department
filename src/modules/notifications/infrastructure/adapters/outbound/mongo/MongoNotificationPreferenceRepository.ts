import type { ClientSession, Collection, Db } from 'mongodb';
import type { NotificationPreference } from '../../../../domain/model/aggregates/NotificationPreference.js';
import type { NotificationPreferenceRepository } from '../../../../domain/ports/NotificationPreferenceRepository.js';
import type { OrganizationId } from '../../../../domain/model/value-objects/OrganizationId.js';
import type { UserId } from '../../../../domain/model/value-objects/UserId.js';
import type { AlertType } from '../../../../domain/model/value-objects/AlertType.js';
import type { NotificationChannel } from '../../../../domain/model/value-objects/NotificationChannel.js';
import type { Transaction } from '../../../../domain/ports/UnitOfWork.js';
import type { NotificationPreferenceDocument } from './documents/NotificationPreferenceDocument.js';
import { toDomain, toUpsertFields } from './mappers/NotificationPreferenceDocumentMapper.js';

/** Casts the opaque `Transaction` handle back to a real Mongo `ClientSession` (design D3/D11). */
function toSession(tx: Transaction | undefined): ClientSession | undefined {
  return tx as unknown as ClientSession | undefined;
}

const COLLECTION_NAME = 'NotificationPreferences';

/** Mongo adapter for `NotificationPreferenceRepository` (design D4/D5). */
export class MongoNotificationPreferenceRepository implements NotificationPreferenceRepository {
  private readonly collection: Collection<NotificationPreferenceDocument>;

  constructor(db: Db) {
    this.collection = db.collection<NotificationPreferenceDocument>(COLLECTION_NAME);
  }

  async findByUser(organizationId: OrganizationId, userId: UserId, tx?: Transaction): Promise<NotificationPreference[]> {
    const documents = await this.collection
      .find({ OrganizationId: organizationId, UserId: userId }, { session: toSession(tx) })
      .toArray();
    return documents.map(toDomain);
  }

  async findOne(
    organizationId: OrganizationId,
    userId: UserId,
    alertType: AlertType,
    channel: NotificationChannel,
    tx?: Transaction,
  ): Promise<NotificationPreference | null> {
    const document = await this.collection.findOne(
      { OrganizationId: organizationId, UserId: userId, AlertType: alertType, Channel: channel },
      { session: toSession(tx) },
    );
    return document ? toDomain(document) : null;
  }

  /**
   * Atomic field-wise upsert (design D5): the create/found branches are
   * decided by Mongo itself (`$set` vs `$setOnInsert`), never by a prior
   * app-layer read. Returns the persisted post-image.
   */
  async upsert(pref: NotificationPreference, tx: Transaction): Promise<NotificationPreference> {
    const { key, set, setOnInsert } = toUpsertFields(pref);
    const document = await this.collection.findOneAndUpdate(
      key,
      { $set: set, $setOnInsert: { ...key, ...setOnInsert } },
      { upsert: true, returnDocument: 'after', session: toSession(tx) },
    );
    return toDomain(document!);
  }
}
