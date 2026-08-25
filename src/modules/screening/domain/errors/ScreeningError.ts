import { DomainError } from '../../../../shared/kernel/DomainError.js';
import type { ScreeningErrorCode } from './ScreeningErrorCode.js';

/**
 * The one concrete `DomainError` subtype for the whole `screening` module
 * (mirrors `RiskAssessmentError`). HTTP status mapping lives in the HTTP
 * layer, never here.
 */
export class ScreeningError extends DomainError {
  constructor(
    code: ScreeningErrorCode,
    message: string,
    metadata: Readonly<Record<string, unknown>> = {},
  ) {
    super(code, message, metadata);
  }
}

export function invariantViolation(
  message: string,
  metadata: Readonly<Record<string, unknown>> = {},
): ScreeningError {
  return new ScreeningError('INVARIANT_VIOLATION', message, metadata);
}

export function invalidTransition(current: string, next: string): ScreeningError {
  return new ScreeningError(
    'INVALID_TRANSITION',
    `cannot transition AmlAlert from "${current}" to "${next}"`,
    { current, next },
  );
}

export function forbiddenCrossTenant(message: string): ScreeningError {
  return new ScreeningError('FORBIDDEN_CROSS_TENANT', message, {});
}

export function amlAlertNotFound(alertId: string): ScreeningError {
  return new ScreeningError('AML_ALERT_NOT_FOUND', `AmlAlert "${alertId}" was not found`, {
    alertId,
  });
}

/**
 * Both "no such id" and "belongs to another organization" resolve to the
 * same 404 (spec RNF-1: never leak cross-tenant existence).
 */
export function watchlistNotFound(watchlistId: string): ScreeningError {
  return new ScreeningError('WATCHLIST_NOT_FOUND', `Watchlist "${watchlistId}" was not found`, {
    watchlistId,
  });
}

export function watchlistNameTaken(name: string): ScreeningError {
  return new ScreeningError('WATCHLIST_NAME_TAKEN', `Watchlist name "${name}" is already in use`, {
    name,
  });
}
