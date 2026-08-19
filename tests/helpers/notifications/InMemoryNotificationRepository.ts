import type { Notification } from '../../../src/modules/notifications/domain/model/aggregates/Notification.js';
import type {
  NotificationListPage,
  NotificationRepository,
} from '../../../src/modules/notifications/domain/ports/NotificationRepository.js';
import type { NotificationId } from '../../../src/modules/notifications/domain/model/value-objects/NotificationId.js';
import type { OrganizationId } from '../../../src/modules/notifications/domain/model/value-objects/OrganizationId.js';
import type { UserId } from '../../../src/modules/notifications/domain/model/value-objects/UserId.js';
import type { Transaction } from '../../../src/modules/notifications/domain/ports/UnitOfWork.js';

/** In-memory fake for `NotificationRepository`, newest first like the Mongo adapter. */
export class InMemoryNotificationRepository implements NotificationRepository {
  private readonly byId = new Map<string, Notification>();

  async save(notification: Notification, _tx?: Transaction): Promise<void> {
    this.byId.set(notification.id, notification);
  }

  async findById(id: NotificationId, _tx?: Transaction): Promise<Notification | null> {
    return this.byId.get(id) ?? null;
  }

  async listForUser(
    organizationId: OrganizationId,
    userId: UserId,
    options: { limit?: number; unreadOnly?: boolean } = {},
    _tx?: Transaction,
  ): Promise<NotificationListPage> {
    const mine = [...this.byId.values()].filter(
      (n) => n.organizationId === organizationId && n.recipientUserId === userId,
    );

    const sorted = mine.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const filtered = options.unreadOnly ? sorted.filter((n) => !n.isRead) : sorted;

    return {
      items: filtered.slice(0, options.limit ?? 50),
      // El contador SIEMPRE cuenta no leidos, aunque la lista pidiera todos:
      // es lo que muestra el icono.
      unreadCount: mine.filter((n) => !n.isRead).length,
    };
  }

  all(): Notification[] {
    return [...this.byId.values()];
  }
}
