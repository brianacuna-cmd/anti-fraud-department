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
  | 'ORGANIZATION_FRAUD_CONFIG_NOT_FOUND';
