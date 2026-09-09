import { unknownNotificationStatus } from '../../errors/NotificationsError.js';

/**
 * Closed catalog of notification read-state values (design D1, mirrors
 * `AlertType`/`NotificationChannel`). Not branded — a closed enum, not an
 * opaque id.
 */
export type NotificationStatus = 'UNREAD' | 'READ';

/** Full catalog, used for validation. */
export const NOTIFICATION_STATUSES = ['UNREAD', 'READ'] as const;

const VALID_NOTIFICATION_STATUSES: ReadonlySet<string> = new Set<NotificationStatus>(NOTIFICATION_STATUSES);

export function createNotificationStatus(value: string): NotificationStatus {
  if (!VALID_NOTIFICATION_STATUSES.has(value)) {
    throw unknownNotificationStatus(value);
  }
  return value as NotificationStatus;
}
