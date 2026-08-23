import { DomainError } from '../../../../shared/kernel/DomainError.js';
import type { CaseManagementErrorCode } from './CaseManagementErrorCode.js';

/**
 * The one concrete `DomainError` subtype for the whole `case-management`
 * module (mirrors `IdentityAccessError`). HTTP status mapping lives in the
 * HTTP layer (`infrastructure/adapters/inbound/http/errorStatus.ts`), never
 * here.
 */
export class CaseManagementError extends DomainError {
  constructor(
    code: CaseManagementErrorCode,
    message: string,
    metadata: Readonly<Record<string, unknown>> = {},
  ) {
    super(code, message, metadata);
  }
}

export function invariantViolation(
  message: string,
  metadata: Readonly<Record<string, unknown>> = {},
): CaseManagementError {
  return new CaseManagementError('INVARIANT_VIOLATION', message, metadata);
}

export function invalidTransition(current: string, next: string): CaseManagementError {
  return new CaseManagementError(
    'INVALID_TRANSITION',
    `cannot transition from "${current}" to "${next}"`,
    { current, next },
  );
}

export function forbiddenCrossTenant(
  message = 'actor is not authorized to perform this cross-tenant operation',
): CaseManagementError {
  return new CaseManagementError('FORBIDDEN_CROSS_TENANT', message);
}

export function forbiddenRole(
  roleId: string | null,
  allowed: readonly string[],
): CaseManagementError {
  return new CaseManagementError(
    'FORBIDDEN_ROLE',
    `role "${roleId ?? 'null'}" is not authorized for this operation`,
    { roleId, allowed: [...allowed] },
  );
}

/**
 * El actor pertenece al plano de gobierno (`ORGANIZATION`, `ADMIN`,
 * `AUDITOR`): observa el inquilino entero y no opera sobre él.
 *
 * Se separa de `forbiddenRole` porque el mensaje es lo unico que llega a la
 * pantalla: `role "null" is not authorized` no le dice a nadie que su acceso
 * es de solo lectura por diseno, ni a quien tiene que pedirle la accion.
 */
export function forbiddenReadOnly(
  auth: { readonly actorType: string; readonly roleId: string | null },
  allowed: readonly string[],
): CaseManagementError {
  const actor = auth.actorType === 'USER' ? (auth.roleId ?? 'null') : auth.actorType;
  return new CaseManagementError(
    'FORBIDDEN_ROLE',
    `"${actor}" has read-only access to case management; this operation requires one of: ${allowed.join(', ')}`,
    { actor, allowed: [...allowed], readOnly: true },
  );
}

/**
 * Principio de cuatro ojos: quien solicita una sancion no puede autorizarla.
 *
 * Codigo propio y no `FORBIDDEN_ROLE` porque no es un problema de rol — el
 * supervisor que la pidio TIENE el rol para aprobar. Lo que falla es la
 * separacion entre quien propone y quien revisa, y quien lo recibe necesita
 * entender que la accion no es suya, sino de otra persona.
 */
export function selfApprovalForbidden(
  requesterId: string,
  approvalRequestId: string,
): CaseManagementError {
  return new CaseManagementError(
    'SELF_APPROVAL_FORBIDDEN',
    'the requester of an enforcement action cannot review it: dual control requires a second person',
    { requesterId, approvalRequestId },
  );
}

export function organizationFraudConfigNotFound(organizationId: string): CaseManagementError {
  return new CaseManagementError(
    'ORGANIZATION_FRAUD_CONFIG_NOT_FOUND',
    `no OrganizationFraudConfig exists for organization "${organizationId}"`,
    { organizationId },
  );
}

export function caseNotFound(caseId: string): CaseManagementError {
  return new CaseManagementError('CASE_NOT_FOUND', `case "${caseId}" was not found`, { caseId });
}

export function enforcementActionNotFound(enforcementActionId: string): CaseManagementError {
  return new CaseManagementError(
    'ENFORCEMENT_ACTION_NOT_FOUND',
    `enforcement action "${enforcementActionId}" was not found`,
    { enforcementActionId },
  );
}

export function routingRuleNotFound(ruleId: string): CaseManagementError {
  return new CaseManagementError(
    'ROUTING_RULE_NOT_FOUND',
    `routing rule "${ruleId}" was not found`,
    { ruleId },
  );
}

export function investigationNotFound(investigationId: string): CaseManagementError {
  return new CaseManagementError(
    'INVESTIGATION_NOT_FOUND',
    `investigation "${investigationId}" was not found`,
    { investigationId },
  );
}

export function caseReportNotFound(reportId: string): CaseManagementError {
  return new CaseManagementError('CASE_REPORT_NOT_FOUND', `case report "${reportId}" was not found`, {
    reportId,
  });
}

export function evidenceNotFound(evidenceId: string): CaseManagementError {
  return new CaseManagementError('EVIDENCE_NOT_FOUND', `evidence "${evidenceId}" was not found`, {
    evidenceId,
  });
}

export function caseNoteNotFound(noteId: string): CaseManagementError {
  return new CaseManagementError('CASE_NOTE_NOT_FOUND', `case note "${noteId}" was not found`, {
    noteId,
  });
}

export function approvalRequestNotFound(approvalRequestId: string): CaseManagementError {
  return new CaseManagementError(
    'APPROVAL_REQUEST_NOT_FOUND',
    `approval request "${approvalRequestId}" was not found`,
    { approvalRequestId },
  );
}

/**
 * INV-015: el antivirus reconocio malware. Se nombra la firma porque el
 * analista necesita saber QUE se detecto —un falso positivo de un PDF con
 * macros no se trata igual que un troyano— y porque sin ella el rechazo es
 * indistinguible de un fallo del sistema.
 */
export function evidenceInfected(filename: string, signature: string): CaseManagementError {
  return new CaseManagementError(
    'EVIDENCE_INFECTED',
    `evidence "${filename}" was rejected by the malware scanner: ${signature}`,
    { filename, signature },
  );
}

/**
 * Un expediente sin responsable esta congelado.
 *
 * La regla existe para que ningun caso avance mientras nadie responde por el:
 * un expediente que se instruye, se dictamina y se cierra sin que conste quien
 * lo llevaba es justo el que no se puede defender despues.
 */
export function caseNotAssigned(caseId: string): CaseManagementError {
  return new CaseManagementError(
    'CASE_NOT_ASSIGNED',
    'the case has no assignee: it must be assigned before it can be worked',
    { caseId },
  );
}

/**
 * Un expediente cerrado ya no se instruye.
 *
 * El mensaje nombra el camino de salida —reabrir— porque quien recibe este
 * error casi siempre tiene el permiso y solo le falta saber que hay un paso
 * previo.
 */
export function caseClosed(caseId: string, status: string): CaseManagementError {
  return new CaseManagementError(
    'CASE_CLOSED',
    `the case is ${status.toLowerCase()}: reopen it before working on it again`,
    { caseId, status },
  );
}
