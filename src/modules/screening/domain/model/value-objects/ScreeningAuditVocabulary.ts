/**
 * Screening's OWN closed audit vocabulary (design D5, exact twin of
 * `CaseManagementAuditVocabulary`). Extend as more AML actions get audited.
 */
export type ScreeningAuditAction = 'RESOLVE_AML_ALERT';

export type ScreeningAuditResource = 'aml_alert';
