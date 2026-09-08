/**
 * sar's OWN closed Action/Resource vocabulary for audit emission. Plain
 * unions, NOT branded — mirrors case-management/risk-assessment.
 */
export type SarAuditAction =
  | 'CREATE_SAR_REPORT_DRAFT'
  | 'APPROVE_SAR_REPORT'
  | 'UPSERT_SAR_FILING_PROFILE'
  /**
   * A report file was built. Audited because the file is what leaves the
   * building: knowing a filing document exists, and who produced it, is the
   * whole point of a compliance trail.
   */
  | 'GENERATE_SAR_REPORT_FILE'
  /** SAR-004: the regulator's answer — accepted with a tracking number, or bounced. */
  | 'RECORD_SAR_FILING_STATUS';

export type SarAuditResource = 'sar_report' | 'sar_filing_profile';
