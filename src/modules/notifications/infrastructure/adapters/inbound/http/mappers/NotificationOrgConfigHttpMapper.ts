import type { NotificationOrgConfig } from '../../../../../domain/model/aggregates/NotificationOrgConfig.js';

export interface NotificationOrgConfigResponseDto {
  readonly webhookUrl: string | null;
  /**
   * Whether a signing secret is configured. The value does NOT leave: it
   * exists on the aggregate for forward-compatibility only (spec Req 4).
   */
  readonly secretSet: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function toNotificationOrgConfigResponse(config: NotificationOrgConfig): NotificationOrgConfigResponseDto {
  return {
    webhookUrl: config.webhookUrl,
    secretSet: config.secret !== null,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
  };
}
