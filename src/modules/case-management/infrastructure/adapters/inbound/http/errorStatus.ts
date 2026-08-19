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
  ORGANIZATION_FRAUD_CONFIG_NOT_FOUND: 404,
  CASE_NOT_FOUND: 404,
  // 422 y no 404: el caso existe, lo que no es válido es el destinatario.
  ASSIGNEE_NOT_FOUND: 422,
};
