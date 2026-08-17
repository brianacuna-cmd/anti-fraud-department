import type { ClientSession, Collection, Db } from 'mongodb';
import type { Notification } from '../../../../domain/model/aggregates/Notification.js';
import type { NotificationRepository } from '../../../../domain/ports/NotificationRepository.js';
import type { Transaction } from '../../../../domain/ports/UnitOfWork.js';
import type { NotificationDocument } from './documents/NotificationDocument.js';
import { toDocument } from './mappers/NotificationDocumentMapper.js';

function toSession(tx: Transaction | undefined): ClientSession | undefined {
  return tx as unknown as ClientSession | undefined;
}

const COLLECTION_NAME = 'notifications';

export class MongoNotificationRepository implements NotificationRepository {
  private readonly collection: Collection<NotificationDocument>;

  constructor(db: Db) {
    this.collection = db.collection<NotificationDocument>(COLLECTION_NAME);
  }

  async save(notification: Notification, tx?: Transaction): Promise<void> {
    await this.collection.insertOne(toDocument(notification), { session: toSession(tx) });
  }
}
