/**
 * Closed set of error codes owned by the `case-management` module (mirrors
 * `IdentityAccessErrorCode`'s "lista cerrada por módulo" convention). Only
 * the codes needed by Slice 1 (Foundation) are declared here — later slices
 * extend this union explicitly as new use cases land.
 */
export type CaseManagementErrorCode =
  | 'INVARIANT_VIOLATION'
  | 'INVALID_TRANSITION'
  | 'FORBIDDEN_CROSS_TENANT'
  | 'FORBIDDEN_ROLE'
  | 'ORGANIZATION_FRAUD_CONFIG_NOT_FOUND'
  | 'CASE_NOT_FOUND'
  | 'ENFORCEMENT_ACTION_NOT_FOUND'
  | 'ROUTING_RULE_NOT_FOUND'
  | 'INVESTIGATION_NOT_FOUND'
  | 'CASE_REPORT_NOT_FOUND'
  | 'EVIDENCE_NOT_FOUND'
  | 'CASE_NOTE_NOT_FOUND'
  | 'APPROVAL_REQUEST_NOT_FOUND'
  | 'SELF_APPROVAL_FORBIDDEN'
  /**
   * INV-015: el antivirus encontro malware en el fichero subido. El fichero NO
   * se almacena ni se registra: lo unico que queda es la entrada de auditoria.
   */
  | 'EVIDENCE_INFECTED'
  /**
   * El expediente no tiene responsable y por tanto no se puede trabajar. No es
   * un problema de permisos —quien lo intenta puede tener el rol correcto—
   * sino del estado del propio expediente.
   */
  | 'CASE_NOT_ASSIGNED'
  /**
   * El expediente esta cerrado y por tanto ya no se instruye. Se resuelve
   * reabriendolo, no cambiando de usuario ni reintentando.
   */
  | 'CASE_CLOSED';
