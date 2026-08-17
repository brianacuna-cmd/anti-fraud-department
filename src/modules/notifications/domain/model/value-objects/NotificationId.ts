import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';
import { generateObjectIdHex, isObjectIdHex } from '../../../../../shared/kernel/ObjectIdHex.js';
import { invariantViolation } from '../../errors/NotificationsError.js';

export type NotificationId = Brand<string, 'NotificationId'>;

/** Validates a raw id coming from persistence (mirrors `CaseSlaTrackingId`). */
export function createNotificationId(value: string): NotificationId {
  if (!isObjectIdHex(value)) {
    throw invariantViolation('NotificationId must be a 24-character hexadecimal ObjectId', { value });
  }
  return brand<string, 'NotificationId'>(value);
}

/** Mints a fresh id: a 24-char hex string the Mongo mapper stores as `ObjectId`. */
export function generateNotificationId(): NotificationId {
  return brand<string, 'NotificationId'>(generateObjectIdHex());
}
