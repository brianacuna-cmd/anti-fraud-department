import type { NotificationPreference } from '../../../../../domain/model/aggregates/NotificationPreference.js';
import type { NotificationPreferenceMatrixEntry } from '../../../../../application/GetNotificationPreferences.js';
import { ALERT_TYPE_TO_WIRE } from '../dto/notificationPreferenceSchemas.js';

/** Never leaks `organizationId`/`userId`/`_id`/`createdAt` beyond what the client needs (design D8). */
export interface NotificationPreferenceResponseDto {
  readonly alertType: string;
  readonly channel: string;
  readonly enabled: boolean;
  readonly updatedAt: string;
}

export function toPreferenceResponse(pref: NotificationPreference): NotificationPreferenceResponseDto {
  return {
    alertType: ALERT_TYPE_TO_WIRE[pref.alertType],
    channel: pref.channel,
    enabled: pref.enabled,
    updatedAt: pref.updatedAt,
  };
}

export interface NotificationPreferenceMatrixResponseDto {
  readonly items: readonly Omit<NotificationPreferenceResponseDto, 'updatedAt'>[];
}

export function toPreferenceMatrixResponse(
  matrix: readonly NotificationPreferenceMatrixEntry[],
): NotificationPreferenceMatrixResponseDto {
  return {
    items: matrix.map((entry) => ({
      alertType: ALERT_TYPE_TO_WIRE[entry.alertType],
      channel: entry.channel,
      enabled: entry.enabled,
    })),
  };
}
