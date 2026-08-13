import type { RiskScoringRule } from '../model/aggregates/RiskScoringRule.js';
import type { Transaction } from './UnitOfWork.js';

/**
 * Outbound port for `risk_scoring_rules`. Returns ACTIVE rules for an
 * organization (callers sort/select first by `created_at`).
 */
export interface RiskScoringRuleRepository {
  findActiveByOrganization(organizationId: string, tx?: Transaction): Promise<readonly RiskScoringRule[]>;
}
