/**
 * sar's OWN closed Action/Resource vocabulary for audit emission. Plain
 * unions, NOT branded — mirrors case-management/risk-assessment.
 */
export type SarAuditAction = 'CREATE_SAR_REPORT_DRAFT' | 'APPROVE_SAR_REPORT';

export type SarAuditResource = 'sar_report';
