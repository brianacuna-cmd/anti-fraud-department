import type { StatusByCode } from '../../../../../../shared/http/errorHandler.js';

/**
 * Code -> HTTP status for every closed `CaseManagementErrorCode` (mirrors
 * `identityAccessErrorStatus`). Lives in the HTTP layer, never on the
 * domain error itself.
 */
export const caseManagementErrorStatus: StatusByCode = {
  INVARIANT_VIOLATION: 400,
  INVALID_TRANSITION: 422,
  FORBIDDEN_CROSS_TENANT: 403,
  FORBIDDEN_ROLE: 403,
  ORGANIZATION_FRAUD_CONFIG_NOT_FOUND: 404,
  CASE_NOT_FOUND: 404,
  ENFORCEMENT_ACTION_NOT_FOUND: 404,
  ROUTING_RULE_NOT_FOUND: 404,
  INVESTIGATION_NOT_FOUND: 404,
  CASE_REPORT_NOT_FOUND: 404,
  EVIDENCE_NOT_FOUND: 404,
  CASE_NOTE_NOT_FOUND: 404,
  APPROVAL_REQUEST_NOT_FOUND: 404,
  // 403 y no 422: la peticion es valida, el actor no.
  SELF_APPROVAL_FORBIDDEN: 403,
  // 422 y no 400: la peticion esta bien formada, el fichero es el problema.
  EVIDENCE_INFECTED: 422,
  // 409 y no 403: no falta permiso, falta que alguien tenga el caso. Se
  // resuelve asignandolo, no cambiando de usuario.
  CASE_NOT_ASSIGNED: 409,
  // 409 igual que el anterior: no falta permiso, el expediente esta en un
  // estado que no admite la accion.
  CASE_CLOSED: 409,
  // 409 y no 400: la peticion es correcta, lo que falta es configuracion del
  // inquilino. Se resuelve en «Reglas» y «Ajustes antifraude», no cambiando
  // el cuerpo de la peticion.
  CASE_INTAKE_NOT_CONFIGURED: 409,
  // 422 y no 403: la peticion esta bien formada y quien la hace tiene
  // permiso; el problema es a QUIEN se quiere asignar.
  ASSIGNEE_CANNOT_WORK_CASES: 422,
};
