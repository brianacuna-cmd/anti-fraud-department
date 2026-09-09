import type { Notification } from '../../../src/modules/notifications/domain/model/aggregates/Notification.js';
import type { NotificationId } from '../../../src/modules/notifications/domain/model/value-objects/NotificationId.js';
import type { OrganizationId } from '../../../src/modules/notifications/domain/model/value-objects/OrganizationId.js';
import type { UserId } from '../../../src/modules/notifications/domain/model/value-objects/UserId.js';
import type {
  FindByRecipientOptions,
  NotificationPage,
  NotificationRepository,
} from '../../../src/modules/notifications/domain/ports/NotificationRepository.js';

/** In-memory `NotificationRepository` fake for application-layer unit tests. */
export class InMemoryNotificationRepository implements NotificationRepository {
  private readonly rows: Notification[] = [];

  async save(notification: Notification): Promise<void> {
    this.rows.push(notification);
  }

  async findByRecipient(
    organizationId: OrganizationId,
    recipientUserId: UserId,
    options: FindByRecipientOptions,
  ): Promise<NotificationPage> {
    const matches = this.rows
      .filter((row) => row.organizationId === organizationId && row.recipientUserId === recipientUserId)
      .filter((row) => !options.status || row.status === options.status)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));

    const items = matches.slice(options.offset, options.offset + options.limit);
    return { items, total: matches.length };
  }

  async findById(id: NotificationId): Promise<Notification | null> {
    return this.rows.find((row) => row.id === id) ?? null;
  }

  async markRead(notification: Notification): Promise<void> {
    const index = this.rows.findIndex((row) => row.id === notification.id);
    if (index >= 0) {
      this.rows[index] = notification;
    }
  }

  all(): Notification[] {
    return [...this.rows];
  }
}
