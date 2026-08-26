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
  | 'CASE_CLOSED'
  /**
   * Notes and evidence require the case to have entered `IN_REVIEW` first
   * (`StartReview`). Instruction is the step after review, not before it.
   */
  | 'CASE_NOT_REVIEWED'
  /**
   * A decision cannot be recorded before the case has at least one note or
   * one piece of evidence: a verdict with nothing behind it is not a
   * verdict, it is a guess.
   */
  | 'CASE_NOT_INSTRUCTED'
  /**
   * A case cannot be resolved before at least one analyst decision was
   * recorded on it — closing with no verdict on file is exactly the file
   * that cannot be defended later.
   */
  | 'CASE_NOT_DECIDED'
  /**
   * A `FRAUD_CONFIRMED` decision was recorded but no enforcement action was
   * ever requested for it. Resolving now would close the case as decided
   * fraud with no sanction on record.
   */
  | 'CASE_ENFORCEMENT_PENDING'
  /**
   * The case report/dossier freezes the FULL case file, resolution
   * included — generating it before the case is closed would freeze a
   * story that has not finished yet.
   */
  | 'CASE_NOT_RESOLVED_FOR_REPORT'
  /**
   * A case is about to be created/reopened with no assignee (nobody picked
   * one, and there is no auto-routing to fall back on) AND the organization
   * has zero ACTIVE `CaseRoutingRule`s. Rejected instead of silently opening
   * an orphan case that only an ADMIN/organization login can ever discover
   * and assign by hand.
   */
  | 'NO_ACTIVE_ROUTING_RULE';
