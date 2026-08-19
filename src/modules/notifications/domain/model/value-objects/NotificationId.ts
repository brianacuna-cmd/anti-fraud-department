import { randomBytes } from 'node:crypto';
import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';
import { invariantViolation } from '../../errors/NotificationsError.js';

export type NotificationId = Brand<string, 'NotificationId'>;

export function createNotificationId(value: string): NotificationId {
  if (value.trim().length === 0) {
    throw invariantViolation('NotificationId must be a non-empty string', { value });
  }
  return brand<string, 'NotificationId'>(value);
}

/** Mints a fresh id: a 24-char hex string the Mongo mapper stores as `ObjectId`. */
export function generateNotificationId(): NotificationId {
  return brand<string, 'NotificationId'>(randomBytes(12).toString('hex'));
}
