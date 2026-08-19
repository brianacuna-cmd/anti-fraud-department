import { ObjectId } from 'mongodb';
import { brand } from '../../../../../../../shared/kernel/Brand.js';
import { toDate } from '../../../../../../../shared/time/Instant.js';
import { Notification } from '../../../../../domain/model/aggregates/Notification.js';
import { createNotificationId } from '../../../../../domain/model/value-objects/NotificationId.js';
import { createOrganizationId } from '../../../../../domain/model/value-objects/OrganizationId.js';
import { createUserId } from '../../../../../domain/model/value-objects/UserId.js';
import { createAlertType } from '../../../../../domain/model/value-objects/AlertType.js';
import { createNotificationChannel } from '../../../../../domain/model/value-objects/NotificationChannel.js';
import type { NotificationDocument } from '../documents/NotificationDocument.js';

/** camelCase (domain) -> PascalCase (Mongo). */
export function toDocument(notification: Notification): NotificationDocument {
  return {
    _id: new ObjectId(notification.id),
    OrganizationId: notification.organizationId,
    RecipientUserId: notification.recipientUserId,
    AlertType: notification.alertType,
    Channel: notification.channel,
    Title: notification.title,
    Body: notification.body,
    ResourceType: notification.resourceType,
    ResourceId: notification.resourceId,
    ReadAt: notification.readAt,
    CreatedAt: notification.createdAt,
    CreatedAtDate: toDate(notification.createdAt),
  };
}

/** PascalCase (Mongo) -> camelCase (domain). */
export function toDomain(document: NotificationDocument): Notification {
  return Notification.rehydrate({
    id: createNotificationId(document._id.toString()),
    organizationId: createOrganizationId(document.OrganizationId),
    recipientUserId: createUserId(document.RecipientUserId),
    alertType: createAlertType(document.AlertType),
    channel: createNotificationChannel(document.Channel),
    title: document.Title,
    body: document.Body,
    resourceType: document.ResourceType,
    resourceId: document.ResourceId,
    readAt: document.ReadAt === null ? null : brand<string, 'Instant'>(document.ReadAt),
    createdAt: brand<string, 'Instant'>(document.CreatedAt),
  });
}
