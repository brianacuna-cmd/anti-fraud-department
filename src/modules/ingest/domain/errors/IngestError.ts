import { DomainError } from '../../../../shared/kernel/DomainError.js';
import type { IngestErrorCode } from './IngestErrorCode.js';

/**
 * The one concrete `DomainError` subtype for the whole `ingest` module
 * (mirrors `RiskAssessmentError`). HTTP status mapping lives in the HTTP
 * layer, never here.
 */
export class IngestError extends DomainError {
  constructor(
    code: IngestErrorCode,
    message: string,
    metadata: Readonly<Record<string, unknown>> = {},
  ) {
    super(code, message, metadata);
  }
}

export function invariantViolation(
  message: string,
  metadata: Readonly<Record<string, unknown>> = {},
): IngestError {
  return new IngestError('INVARIANT_VIOLATION', message, metadata);
}

export function forbiddenCrossTenant(
  message = 'actor is not authorized to perform this cross-tenant operation',
): IngestError {
  return new IngestError('FORBIDDEN_CROSS_TENANT', message);
}

export function forbiddenRole(roleId: string | null, allowed: readonly string[]): IngestError {
  return new IngestError(
    'FORBIDDEN_ROLE',
    `role "${roleId ?? 'null'}" is not authorized for this operation`,
    { roleId, allowed: [...allowed] },
  );
}

export function webhookSignatureInvalid(
  message = 'webhook signature is missing or invalid',
): IngestError {
  return new IngestError('WEBHOOK_SIGNATURE_INVALID', message);
}

export function webhookSecretNotFound(organizationId: string, provider: string): IngestError {
  return new IngestError(
    'WEBHOOK_SECRET_NOT_FOUND',
    `no inbound webhook secret exists for organization "${organizationId}" provider "${provider}"`,
    { organizationId, provider },
  );
}
