import { ObjectId, type ClientSession, type Collection, type Db, type Filter } from 'mongodb';
import type { Notification } from '../../../../domain/model/aggregates/Notification.js';
import type { NotificationId } from '../../../../domain/model/value-objects/NotificationId.js';
import type { OrganizationId } from '../../../../domain/model/value-objects/OrganizationId.js';
import type { UserId } from '../../../../domain/model/value-objects/UserId.js';
import type {
  FindByRecipientOptions,
  NotificationPage,
  NotificationRepository,
} from '../../../../domain/ports/NotificationRepository.js';
import type { Transaction } from '../../../../domain/ports/UnitOfWork.js';
import { toDate, type Instant } from '../../../../../../shared/time/Instant.js';
import type { NotificationDocument } from './documents/NotificationDocument.js';
import { toDocument, toDomain } from './mappers/NotificationDocumentMapper.js';

function toSession(tx: Transaction | undefined): ClientSession | undefined {
  return tx as unknown as ClientSession | undefined;
}

const COLLECTION_NAME = 'notifications';

/** Mongo adapter for `NotificationRepository` (save + inbox find/markRead). */
export class MongoNotificationRepository implements NotificationRepository {
  private readonly collection: Collection<NotificationDocument>;

  constructor(db: Db) {
    this.collection = db.collection<NotificationDocument>(COLLECTION_NAME);
  }

  async save(notification: Notification, tx?: Transaction): Promise<void> {
    await this.collection.insertOne(toDocument(notification), { session: toSession(tx) });
  }

  async findByRecipient(
    organizationId: OrganizationId,
    recipientUserId: UserId,
    options: FindByRecipientOptions,
    tx?: Transaction,
  ): Promise<NotificationPage> {
    const session = toSession(tx);
    const filter: Filter<NotificationDocument> = {
      organization_id: new ObjectId(organizationId),
      recipient_user_id: new ObjectId(recipientUserId),
      ...(options.status ? { status: options.status } : {}),
    };

    const total = await this.collection.countDocuments(filter, { session });
    const documents = await this.collection
      .find(filter, {
        session,
        sort: { created_at: -1 },
        skip: options.offset,
        limit: options.limit,
      })
      .toArray();

    return { items: documents.map(toDomain), total };
  }

  async findById(id: NotificationId, tx?: Transaction): Promise<Notification | null> {
    const document = await this.collection.findOne({ _id: new ObjectId(id) }, { session: toSession(tx) });
    return document ? toDomain(document) : null;
  }

  async markRead(notification: Notification, tx?: Transaction): Promise<void> {
    await this.collection.updateOne(
      { _id: new ObjectId(notification.id) },
      { $set: { status: notification.status, updated_at: toDate(notification.updatedAt) } },
      { session: toSession(tx) },
    );
  }

  async markAllReadForRecipient(
    organizationId: OrganizationId,
    recipientUserId: UserId,
    now: Instant,
    tx?: Transaction,
  ): Promise<number> {
    const result = await this.collection.updateMany(
      {
        organization_id: new ObjectId(organizationId),
        recipient_user_id: new ObjectId(recipientUserId),
        status: 'UNREAD',
      },
      { $set: { status: 'READ', updated_at: toDate(now) } },
      { session: toSession(tx) },
    );
    return result.modifiedCount;
  }
}
