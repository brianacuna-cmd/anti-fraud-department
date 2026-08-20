import type { Notification } from '../../../src/modules/notifications/domain/model/aggregates/Notification.js';
import type { NotificationRepository } from '../../../src/modules/notifications/domain/ports/NotificationRepository.js';

/** In-memory `NotificationRepository` fake for application-layer unit tests. */
export class InMemoryNotificationRepository implements NotificationRepository {
  private readonly rows: Notification[] = [];

  async save(notification: Notification): Promise<void> {
    this.rows.push(notification);
  }

  all(): Notification[] {
    return [...this.rows];
  }
}
