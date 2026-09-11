import { DomainError } from '../../../../shared/kernel/DomainError.js';

/**
 * The closed error type for the `audit` module (mirrors design D5's
 * one-concrete-DomainError-subtype-per-module convention). The `audit`
 * domain never imports `identity-access`'s `IdentityAccessError` — each
 * bounded context owns its own error hierarchy (design D-A9 boundary rule).
 */
export class AuditError extends DomainError {
  constructor(code: AuditErrorCode, message: string, metadata: Readonly<Record<string, unknown>> = {}) {
    super(code, message, metadata);
  }
}

export type AuditErrorCode =
  | 'INVARIANT_VIOLATION'
  | 'FORBIDDEN_ROLE'
  | 'FORBIDDEN_CROSS_TENANT'
  /**
   * El export dice ir firmado y no hay clave con que firmarlo.
   *
   * Codigo propio y no un invariante generico: un fichero de auditoria sin
   * firma que se presenta como firmado es peor que no tener export. Quien
   * llama tiene que enterarse de que falta configuracion, no recibir un
   * fichero que parece valido.
   */
  | 'AUDIT_SIGNING_UNAVAILABLE';

export function invariantViolation(
  message: string,
  metadata: Readonly<Record<string, unknown>> = {},
): AuditError {
  return new AuditError('INVARIANT_VIOLATION', message, metadata);
}

export function forbiddenRole(roleId: string | null, allowed: readonly string[]): AuditError {
  return new AuditError(
    'FORBIDDEN_ROLE',
    `role "${roleId ?? 'null'}" is not authorized to read the audit trail`,
    { roleId, allowed: [...allowed] },
  );
}

export function forbiddenCrossTenant(
  message = 'actor is not authorized to perform this cross-tenant operation',
): AuditError {
  return new AuditError('FORBIDDEN_CROSS_TENANT', message);
}

export function signingUnavailable(): AuditError {
  return new AuditError(
    'AUDIT_SIGNING_UNAVAILABLE',
    'the audit trail cannot be exported signed: no signing key is configured',
  );
}
