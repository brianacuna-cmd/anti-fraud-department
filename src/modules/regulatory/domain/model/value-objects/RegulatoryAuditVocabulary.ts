/**
 * regulatory's OWN closed Action/Resource vocabulary for audit emission.
 * Plain unions, NOT branded — mirrors privacy/sar/case-management.
 */
export type RegulatoryAuditAction =
  /** REG-001: se calcularon y congelaron las cifras de un periodo. */
  | 'COMPILE_REGULATORY_REPORT'
  /** El paso irreversible: el reporte pasa a ser el documento oficial. */
  | 'ISSUE_REGULATORY_REPORT'
  /**
   * REG-002: se generó el fichero. Se audita porque es lo que SALE del
   * edificio, y ante una Superintendencia hay que poder decir quién lo produjo
   * y cuándo.
   */
  | 'EXPORT_REGULATORY_REPORT';

export type RegulatoryAuditResource = 'regulatory_report';
