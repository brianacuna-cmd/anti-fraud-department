import { ObjectId, type ClientSession, type Collection, type Db } from 'mongodb';
import type { Notification } from '../../../../domain/model/aggregates/Notification.js';
import type {
  NotificationListPage,
  NotificationRepository,
} from '../../../../domain/ports/NotificationRepository.js';
import type { NotificationId } from '../../../../domain/model/value-objects/NotificationId.js';
import type { OrganizationId } from '../../../../domain/model/value-objects/OrganizationId.js';
import type { UserId } from '../../../../domain/model/value-objects/UserId.js';
import type { Transaction } from '../../../../domain/ports/UnitOfWork.js';
import type { NotificationDocument } from './documents/NotificationDocument.js';
import { toDocument, toDomain } from './mappers/NotificationDocumentMapper.js';

function toSession(tx: Transaction | undefined): ClientSession | undefined {
  return tx as unknown as ClientSession | undefined;
}

const COLLECTION_NAME = 'Notifications';
const DEFAULT_LIMIT = 50;

export class MongoNotificationRepository implements NotificationRepository {
  private readonly collection: Collection<NotificationDocument>;

  constructor(db: Db) {
    this.collection = db.collection<NotificationDocument>(COLLECTION_NAME);
  }

  async save(notification: Notification, tx?: Transaction): Promise<void> {
    const document = toDocument(notification);
    await this.collection.replaceOne({ _id: document._id }, document, {
      upsert: true,
      session: toSession(tx),
    });
  }

  async findById(id: NotificationId, tx?: Transaction): Promise<Notification | null> {
    if (!ObjectId.isValid(id)) return null;
    const document = await this.collection.findOne({ _id: new ObjectId(id) }, { session: toSession(tx) });
    return document ? toDomain(document) : null;
  }

  async listForUser(
    organizationId: OrganizationId,
    userId: UserId,
    options: { limit?: number; unreadOnly?: boolean } = {},
    tx?: Transaction,
  ): Promise<NotificationListPage> {
    const base = { OrganizationId: organizationId, RecipientUserId: userId };
    const filter = options.unreadOnly ? { ...base, ReadAt: null } : base;

    // La lista y el contador van en paralelo pero contra el MISMO destinatario:
    // el contador cuenta siempre los no leidos, tambien cuando la lista pidio
    // todos, porque es lo que muestra el icono.
    const [documents, unreadCount] = await Promise.all([
      this.collection
        .find(filter, { session: toSession(tx) })
        .sort({ CreatedAtDate: -1 })
        .limit(options.limit ?? DEFAULT_LIMIT)
        .toArray(),
      this.collection.countDocuments({ ...base, ReadAt: null }, { session: toSession(tx) }),
    ]);

    return { items: documents.map(toDomain), unreadCount };
  }
}
