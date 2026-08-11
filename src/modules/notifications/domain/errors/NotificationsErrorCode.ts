/**
 * Closed set of error codes owned by the `notifications` module (design D8a,
 * mirrors identity-access's `IdentityAccessErrorCode` convention). Extending
 * this union is a deliberate, explicit change — never an ad-hoc `throw new
 * Error(string)`.
 */
export type NotificationsErrorCode =
  | 'INVARIANT_VIOLATION'
  | 'FORBIDDEN_CROSS_TENANT'
  | 'UNKNOWN_ALERT_TYPE'
  | 'UNKNOWN_CHANNEL';
