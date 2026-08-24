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
