import { ObjectId } from 'mongodb';
import { fromDate, toDate } from '../../../../../../../shared/time/Instant.js';
import { Notification } from '../../../../../domain/model/aggregates/Notification.js';
import { createNotificationId } from '../../../../../domain/model/value-objects/NotificationId.js';
import { createOrganizationId } from '../../../../../domain/model/value-objects/OrganizationId.js';
import { createUserId } from '../../../../../domain/model/value-objects/UserId.js';
import { createAlertType } from '../../../../../domain/model/value-objects/AlertType.js';
import { createNotificationChannel } from '../../../../../domain/model/value-objects/NotificationChannel.js';
import type { NotificationDocument } from '../documents/NotificationDocument.js';

/** snake_case (Mongo) -> camelCase (domain). */
export function toDomain(document: NotificationDocument): Notification {
  return Notification.rehydrate({
    id: createNotificationId(document._id.toString()),
    organizationId: createOrganizationId(document.organization_id.toString()),
    recipientUserId: createUserId(document.recipient_user_id.toString()),
    alertType: createAlertType(document.alert_type),
    channel: createNotificationChannel(document.channel),
    context: document.context,
    createdAt: fromDate(document.created_at),
  });
}

/** domain -> snake_case (Mongo). `_id` is the client-minted `NotificationId`. */
export function toDocument(notification: Notification): NotificationDocument {
  return {
    _id: new ObjectId(notification.id),
    organization_id: new ObjectId(notification.organizationId),
    recipient_user_id: new ObjectId(notification.recipientUserId),
    alert_type: notification.alertType,
    channel: notification.channel,
    context: notification.context,
    created_at: toDate(notification.createdAt),
  };
}
