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
  | 'RESOLVE_CASE'
  | 'REASSIGN_CASE'
  | 'REOPEN_CASE';

export type CaseManagementAuditResource = 'case' | 'entity' | 'user' | 'rule';
