import type { StatusByCode } from '../../../../../../shared/http/errorHandler.js';

/**
 * Code -> HTTP status for every closed `IdentityAccessErrorCode` (design:
 * "errorStatus map"). Lives in the HTTP layer, never on the domain error
 * itself (design D5).
 */
export const identityAccessErrorStatus: StatusByCode = {
  INVALID_TRANSITION: 422,
  FORBIDDEN_REACTIVATION: 403,
  FORBIDDEN_CROSS_TENANT: 403,
  ORGANIZATION_SLUG_TAKEN: 409,
  USER_EMAIL_TAKEN: 409,
  ORGANIZATION_NOT_FOUND: 404,
  USER_NOT_FOUND: 404,
  INVARIANT_VIOLATION: 400,
};
