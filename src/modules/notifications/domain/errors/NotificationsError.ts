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
