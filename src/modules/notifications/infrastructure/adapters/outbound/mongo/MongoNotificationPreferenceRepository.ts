import { ObjectId, type ClientSession, type Collection, type Db } from 'mongodb';
import type { NotificationPreference } from '../../../../domain/model/aggregates/NotificationPreference.js';
import type { NotificationPreferenceRepository } from '../../../../domain/ports/NotificationPreferenceRepository.js';
import type { OrganizationId } from '../../../../domain/model/value-objects/OrganizationId.js';
import type { UserId } from '../../../../domain/model/value-objects/UserId.js';
import { alertTypeStorageValues, type AlertType } from '../../../../domain/model/value-objects/AlertType.js';
import type { NotificationChannel } from '../../../../domain/model/value-objects/NotificationChannel.js';
import type { Transaction } from '../../../../domain/ports/UnitOfWork.js';
import type { NotificationPreferenceDocument } from './documents/NotificationPreferenceDocument.js';
import { toDomain, toUpsertFields } from './mappers/NotificationPreferenceDocumentMapper.js';

function toSession(tx: Transaction | undefined): ClientSession | undefined {
  return tx as unknown as ClientSession | undefined;
}

const COLLECTION_NAME = 'notification_preferences';

export class MongoNotificationPreferenceRepository implements NotificationPreferenceRepository {
  private readonly collection: Collection<NotificationPreferenceDocument>;

  constructor(db: Db) {
    this.collection = db.collection<NotificationPreferenceDocument>(COLLECTION_NAME);
  }

  async findByUser(organizationId: OrganizationId, userId: UserId, tx?: Transaction): Promise<NotificationPreference[]> {
    const documents = await this.collection
      .find(
        { organization_id: new ObjectId(organizationId), user_id: new ObjectId(userId) },
        { session: toSession(tx) },
      )
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
      {
        organization_id: new ObjectId(organizationId),
        user_id: new ObjectId(userId),
        alert_type: { $in: [...alertTypeStorageValues(alertType)] },
        channel,
      },
      { session: toSession(tx) },
    );
    return document ? toDomain(document) : null;
  }

  async upsert(pref: NotificationPreference, tx: Transaction): Promise<NotificationPreference> {
    const { key, set, setOnInsert } = toUpsertFields(pref);
    const session = toSession(tx);
    const existing = await this.collection.findOne(
      {
        organization_id: key.organization_id,
        user_id: key.user_id,
        alert_type: { $in: [...alertTypeStorageValues(pref.alertType)] },
        channel: key.channel,
      },
      { session },
    );
    if (existing) {
      const document = await this.collection.findOneAndUpdate(
        { _id: existing._id },
        { $set: { ...set, alert_type: pref.alertType } },
        { returnDocument: 'after', session },
      );
      return toDomain(document!);
    }
    const document = await this.collection.findOneAndUpdate(
      key,
      { $set: set, $setOnInsert: { ...key, ...setOnInsert } },
      { upsert: true, returnDocument: 'after', session },
    );
    return toDomain(document!);
  }
}
