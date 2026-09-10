import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';
import { generateObjectIdHex, isObjectIdHex } from '../../../../../shared/kernel/ObjectIdHex.js';
import { invariantViolation } from '../../errors/NotificationsError.js';

export type NotificationOrgConfigId = Brand<string, 'NotificationOrgConfigId'>;

/** Validates a raw id coming from persistence (mirrors `NotificationId`). */
export function createNotificationOrgConfigId(value: string): NotificationOrgConfigId {
  if (!isObjectIdHex(value)) {
    throw invariantViolation('NotificationOrgConfigId must be a 24-character hexadecimal ObjectId', { value });
  }
  return brand<string, 'NotificationOrgConfigId'>(value);
}

/** Mints a fresh id: a 24-char hex string the Mongo mapper stores as `ObjectId`. */
export function generateNotificationOrgConfigId(): NotificationOrgConfigId {
  return brand<string, 'NotificationOrgConfigId'>(generateObjectIdHex());
}
