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
  | 'CASE_NOTE_NOT_FOUND';
