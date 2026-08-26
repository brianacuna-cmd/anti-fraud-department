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
  // 403 not 422: the request is valid, the actor is not.
  SELF_APPROVAL_FORBIDDEN: 403,
  // 422 not 400: the request is well formed, the file is the problem.
  EVIDENCE_INFECTED: 422,
  // 409 not 403: permission is not missing, someone having the case is.
  // It is resolved by assigning it, not by switching users.
  CASE_NOT_ASSIGNED: 409,
  // 409 same as the previous: permission is not missing, the case is in a
  // state that does not admit the action.
  CASE_CLOSED: 409,
  // 409 same family: the case is not (yet) in the state the workflow step
  // requires. See `WorkflowStepGate`.
  CASE_NOT_REVIEWED: 409,
  CASE_NOT_INSTRUCTED: 409,
  CASE_NOT_DECIDED: 409,
  CASE_ENFORCEMENT_PENDING: 409,
  CASE_NOT_RESOLVED_FOR_REPORT: 409,
  // 409: the request is valid, but creating/reopening the case unassigned
  // right now would leave it with no path to ever getting assigned.
  NO_ACTIVE_ROUTING_RULE: 409,
};
