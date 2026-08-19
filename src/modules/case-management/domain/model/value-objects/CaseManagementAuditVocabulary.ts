/**
 * case-management's OWN closed Action/Resource vocabulary for audit
 * emission (design "Cross-module seams: Audit reuse"). Plain unions, NOT
 * branded — mirrors `IdentityAccessAuditAction`/`IdentityAccessAuditResource`.
 *
 * Only Slice 5's action (`CREATE_CASE`) is wired to a real use case yet;
 * the remaining actions are declared now (design's fixed list) so later
 * slices (6-13) don't need to touch this file again.
 */
export type CaseManagementAuditAction =
  | 'CREATE_CASE'
  | 'UPDATE_SCORE'
  | 'START_REVIEW'
  | 'RESOLVE_CASE'
  | 'ARCHIVE_CASE'
  | 'REASSIGN_CASE'
  | 'REOPEN_CASE'
  | 'UPDATE_PRIORITY_TAGS'
  | 'BULK_CASE_ACTION'
  | 'ADD_CASE_NOTE'
  | 'OPEN_INVESTIGATION'
  | 'CLOSE_INVESTIGATION'
  | 'UPDATE_INVESTIGATION_FINDINGS'
  | 'GENERATE_CASE_REPORT'
  | 'REGISTER_EVIDENCE'
  | 'RECORD_ANALYST_DECISION'
  | 'APPROVE_ENFORCEMENT_ACTION'
  | 'REJECT_ENFORCEMENT_ACTION'
  | 'EXECUTE_ENFORCEMENT_ACTION'
  | 'CREATE_ROUTING_RULE'
  | 'ACTIVATE_ROUTING_RULE'
  | 'DEACTIVATE_ROUTING_RULE'
  /**
   * CASE-002 (T1): a rule whose JDM could not be evaluated was SKIPPED rather
   * than aborting case creation. Not a user action — it is the only durable
   * trail for an unusable rule while this module has no logger port. Pending
   * confirmation with the team (design open point: "Enums de EventType/Action
   * ... confirmar los nombres exactos").
   */
  | 'ROUTING_RULE_EVALUATION_FAILED';

export type CaseManagementAuditResource =
  | 'case'
  | 'entity'
  | 'user'
  | 'rule'
  | 'investigation'
  | 'report'
  | 'evidence';
