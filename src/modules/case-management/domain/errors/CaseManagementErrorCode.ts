/**
 * Closed set of error codes owned by the `case-management` module (mirrors
 * `IdentityAccessErrorCode`'s "closed set per module" convention). Only
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
   * INV-015: the antivirus found malware in the uploaded file. The file is
   * NOT stored or registered: the only thing left is the audit row.
   */
  | 'EVIDENCE_INFECTED'
  /**
   * The case has no assignee and therefore cannot be worked. This is not a
   * permissions problem —whoever tries may have the correct role— but of the
   * state of the case itself.
   */
  | 'CASE_NOT_ASSIGNED'
  /**
   * The case is closed and therefore is no longer worked. It is resolved by
   * reopening it, not by changing user or retrying.
   */
  | 'CASE_CLOSED';
