import { DomainError } from '../../../../shared/kernel/DomainError.js';
import type { NotificationsErrorCode } from './NotificationsErrorCode.js';

/**
 * The one concrete `DomainError` subtype for the whole `notifications`
 * module (design D8a). HTTP status mapping lives in the HTTP layer
 * (`infrastructure/adapters/inbound/http/errorStatus.ts`), never here.
 */
export class NotificationsError extends DomainError {
  constructor(
    code: NotificationsErrorCode,
    message: string,
    metadata: Readonly<Record<string, unknown>> = {},
  ) {
    super(code, message, metadata);
  }
}

export function invariantViolation(
  message: string,
  metadata: Readonly<Record<string, unknown>> = {},
): NotificationsError {
  return new NotificationsError('INVARIANT_VIOLATION', message, metadata);
}

export function forbiddenCrossTenant(
  message = 'actor is not authorized to perform this cross-tenant operation',
): NotificationsError {
  return new NotificationsError('FORBIDDEN_CROSS_TENANT', message);
}

export function unknownAlertType(value: string): NotificationsError {
  return new NotificationsError('UNKNOWN_ALERT_TYPE', `unknown alert type "${value}"`, { value });
}

export function unknownChannel(value: string): NotificationsError {
  return new NotificationsError('UNKNOWN_CHANNEL', `unknown notification channel "${value}"`, { value });
}

/** R2/D2: the channel is valid (in CHANNELS) but not configurable by the user (e.g. IN_APP). */
export function channelNotConfigurable(value: string): NotificationsError {
  return new NotificationsError(
    'NOTIFICATION_CHANNEL_NOT_CONFIGURABLE',
    `notification channel "${value}" is not configurable`,
    { value },
  );
}

export function unknownNotificationStatus(value: string): NotificationsError {
  return new NotificationsError('UNKNOWN_NOTIFICATION_STATUS', `unknown notification status "${value}"`, { value });
}

export function notificationNotFound(id: string): NotificationsError {
  return new NotificationsError('NOTIFICATION_NOT_FOUND', 'La notificacion no existe', { id });
}

/** R4/D7: the caller is not the notification's recipient — distinct from cross-tenant. */
export function forbiddenNotRecipient(id: string): NotificationsError {
  return new NotificationsError(
    'NOTIFICATION_FORBIDDEN_NOT_RECIPIENT',
    `actor is not the recipient of notification "${id}"`,
    { id },
  );
}
