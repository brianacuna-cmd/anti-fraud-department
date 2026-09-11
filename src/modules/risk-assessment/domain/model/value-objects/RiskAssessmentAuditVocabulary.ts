/**
 * risk-assessment's OWN closed Action/Resource vocabulary for audit
 * emission. Plain unions, NOT branded — mirrors case-management.
 */
export type RiskAssessmentAuditAction =
  | 'CALCULATE_RISK_SCORE'
  | 'SCORING_RULE_EVALUATION_FAILED'
  | 'CREATE_SCORING_RULE'
  | 'ACTIVATE_SCORING_RULE'
  | 'SIMULATE_SCORING_RULE'
  /** Soft delete: the rule leaves the list, the row stays for traceability. */
  | 'DELETE_SCORING_RULE'
  /** In-place patch of name and/or JDM conditions; status is not patchable. */
  | 'UPDATE_SCORING_RULE';

export type RiskAssessmentAuditResource = 'rule';
