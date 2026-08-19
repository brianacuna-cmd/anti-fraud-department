/**
 * case-management's OWN closed Action/Resource vocabulary for audit
 * emission (design "Cross-module seams: Audit reuse"). Plain unions, NOT
 * branded — mirrors `IdentityAccessAuditAction`/`IdentityAccessAuditResource`.
 *
 * Grouped by the subsystem that emits each action. The list stays closed on
 * purpose: `audit_logs` is the record a regulator reads, and an open string
 * would let each call site invent its own verb for the same operation, which
 * makes the log impossible to query after the fact.
 */
export type CaseManagementAuditAction =
  // --- Case lifecycle ---
  | 'CREATE_CASE'
  | 'CASE_INGESTED_WEBHOOK'
  | 'UPDATE_SCORE'
  | 'RECLASSIFY_CASE'
  | 'REASSIGN_CASE'
  | 'ROUTE_CASE'
  | 'RESOLVE_CASE'
  | 'REOPEN_CASE'
  | 'BULK_UPDATE_CASES'
  | 'EXPORT_CASES'
  // --- Investigation ---
  | 'ADD_NOTE'
  | 'DELETE_NOTE'
  | 'UPLOAD_EVIDENCE'
  | 'SCAN_EVIDENCE'
  | 'TIMESTAMP_EVIDENCE'
  | 'DOWNLOAD_EVIDENCE'
  | 'DELETE_EVIDENCE'
  | 'RECORD_DECISION'
  | 'GENERATE_REPORT'
  | 'CREATE_INVESTIGATION'
  | 'UPDATE_INVESTIGATION'
  | 'LINK_CASES'
  // --- Enforcement and approvals ---
  | 'REQUEST_ENFORCEMENT'
  | 'REVIEW_APPROVAL'
  | 'EXECUTE_ENFORCEMENT'
  | 'REVERT_ENFORCEMENT'
  // --- Customer disputes ---
  | 'CREATE_DISPUTE'
  | 'RESOLVE_DISPUTE';

export type CaseManagementAuditResource =
  | 'case'
  | 'entity'
  | 'user'
  | 'rule'
  | 'note'
  | 'evidence'
  | 'investigation'
  | 'enforcement_action'
  | 'approval_request'
  | 'dispute'
  | 'report';
