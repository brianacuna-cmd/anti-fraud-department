/**
 * Screening's OWN closed audit vocabulary (design D5, exact twin of
 * `CaseManagementAuditVocabulary`). Extend as more AML actions get audited.
 */
export type ScreeningAuditAction =
  | 'RESOLVE_AML_ALERT'
  | 'CREATE_WATCHLIST'
  | 'UPDATE_WATCHLIST'
  | 'DELETE_WATCHLIST'
  | 'CREATE_WATCHLIST_ENTRY'
  | 'UPDATE_WATCHLIST_ENTRY'
  | 'DELETE_WATCHLIST_ENTRY';

export type ScreeningAuditResource = 'aml_alert' | 'watchlist' | 'watchlist_entry';
