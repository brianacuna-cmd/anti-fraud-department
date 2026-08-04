/**
 * Closed set of error codes owned by the `identity-access` module (design
 * D5, ESTRUCTURA_REPO.md §2: "lista cerrada por módulo"). Extending this
 * union is a deliberate, explicit change — never an ad-hoc `throw new
 * Error(string)`.
 *
 * `INVARIANT_VIOLATION` covers value-object/DTO guard failures (design Open
 * Question, resolved): any input that never should have reached the domain.
 */
export type IdentityAccessErrorCode =
  | 'INVARIANT_VIOLATION'
  | 'INVALID_TRANSITION'
  | 'FORBIDDEN_REACTIVATION'
  | 'FORBIDDEN_CROSS_TENANT'
  | 'ORGANIZATION_SLUG_TAKEN'
  | 'ORGANIZATION_NOT_FOUND'
  | 'USER_EMAIL_TAKEN'
  | 'USER_NOT_FOUND';
