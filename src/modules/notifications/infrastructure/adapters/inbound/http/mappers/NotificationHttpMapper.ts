import type { Notification } from '../../../../../domain/model/aggregates/Notification.js';
import type { NotificationPage } from '../../../../../domain/ports/NotificationRepository.js';

/** Never leaks `organizationId`/`_id` beyond what the client needs (design D8, mirrors NotificationPreferenceHttpMapper). */
export interface NotificationResponseDto {
  readonly id: string;
  readonly alertType: string;
  readonly channel: string;
  readonly context: Record<string, unknown>;
  readonly status: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function toNotificationResponse(notification: Notification): NotificationResponseDto {
  return {
    id: notification.id,
    alertType: notification.alertType,
    channel: notification.channel,
    context: notification.context,
    status: notification.status,
    createdAt: notification.createdAt,
    updatedAt: notification.updatedAt,
  };
}

export interface NotificationPageResponseDto {
  readonly items: readonly NotificationResponseDto[];
  readonly total: number;
}

export function toNotificationPageResponse(page: NotificationPage): NotificationPageResponseDto {
  return {
    items: page.items.map(toNotificationResponse),
    total: page.total,
  };
}
