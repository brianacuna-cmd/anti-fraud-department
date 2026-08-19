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
};
