import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { Notification } from '../domain/model/aggregates/Notification.js';
import type { NotificationRepository } from '../domain/ports/NotificationRepository.js';
import type { Transaction } from '../domain/ports/UnitOfWork.js';
import { createNotificationId } from '../domain/model/value-objects/NotificationId.js';
import { forbiddenNotRecipient, notificationNotFound } from '../domain/errors/NotificationsError.js';

export interface MarkNotificationReadInput {
  readonly auth: AuthContext;
  readonly id: string;
}

export interface MarkNotificationReadDeps {
  readonly repository: NotificationRepository;
  readonly clock: Clock;
}

/**
 * R4/design use case: only the recipient (derived from `AuthContext.userId`,
 * no impersonation param) may mark a notification read. Already-READ is a
 * success no-op (no write). Simple `tx?` passthrough — NOT `withTransaction`
 * (design decision: a single-document update needs no unit-of-work).
 */
export function createMarkNotificationReadUseCase(deps: MarkNotificationReadDeps) {
  return async function markNotificationRead(
    input: MarkNotificationReadInput,
    tx?: Transaction,
  ): Promise<Notification> {
    const id = createNotificationId(input.id);
    const notification = await deps.repository.findById(id, tx);
    if (!notification) {
      throw notificationNotFound(input.id);
    }
    if (notification.recipientUserId !== input.auth.userId) {
      throw forbiddenNotRecipient(input.id);
    }
    if (notification.status === 'READ') {
      return notification;
    }

    const updated = notification.markRead(deps.clock.now());
    await deps.repository.markRead(updated, tx);
    return updated;
  };
}
