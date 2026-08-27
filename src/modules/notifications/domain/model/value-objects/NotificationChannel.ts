import { unknownChannel } from '../../errors/NotificationsError.js';

/**
 * Closed catalog of notification channels (design D2). Not branded — a
 * closed enum, not an opaque id.
 *
 * `IN_APP` is the inbox inside the dashboard; `EMAIL` leaves the system.
 * They are modeled as distinct channels rather than a single "notify"
 * because the user decides separately: wanting to see an alert when
 * opening the panel does not imply wanting an email for each one.
 */
export type NotificationChannel = 'EMAIL' | 'IN_APP';

/** Full catalog, used for validation. */
export const CHANNELS = ['EMAIL', 'IN_APP'] as const;

/**
 * Channels the user can turn off.
 *
 * `IN_APP` is deliberately LEFT OUT: the dashboard inbox always delivers.
 * Being able to mute it would mean an analyst is assigned a case with no
 * record that they were notified — an accountability hole in an antifraud
 * department, where "I didn't hear about it" has to be verifiable. Email
 * is configurable, because it is the intrusive channel and the one people
 * want to bound.
 */
export const CONFIGURABLE_CHANNELS = ['EMAIL'] as const;

const VALID_CHANNELS: ReadonlySet<string> = new Set<NotificationChannel>(CHANNELS);

export function createNotificationChannel(value: string): NotificationChannel {
  if (!VALID_CHANNELS.has(value)) {
    throw unknownChannel(value);
  }
  return value as NotificationChannel;
}
