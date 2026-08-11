import { unknownChannel } from '../../errors/NotificationsError.js';

/**
 * Closed catalog of notification channels (design D2). Currently `EMAIL`
 * only, structurally ready for `SMS`/`PUSH` with zero schema migration
 * (channel is an explicit key field, not embedded). Not branded — a closed
 * enum, not an opaque id.
 */
export type NotificationChannel = 'EMAIL';

/** Single source of truth for iteration and the HTTP wire mapping (design D2). */
export const CHANNELS = ['EMAIL'] as const;

const VALID_CHANNELS: ReadonlySet<string> = new Set<NotificationChannel>(CHANNELS);

export function createNotificationChannel(value: string): NotificationChannel {
  if (!VALID_CHANNELS.has(value)) {
    throw unknownChannel(value);
  }
  return value as NotificationChannel;
}
