import type { RiskScoringRule } from '../model/aggregates/RiskScoringRule.js';
import type { RiskScoringRuleId } from '../model/value-objects/RiskScoringRuleId.js';
import type { Transaction } from './UnitOfWork.js';

/**
 * Outbound port for `risk_scoring_rules`. Returns ACTIVE rules for an
 * organization (unique ACTIVE per org ⇒ callers take `rules[0]`).
 * Mutating flows (draft/activate) use `save` / `findById` / `listByOrganization`.
 */
export interface RiskScoringRuleRepository {
  findActiveByOrganization(organizationId: string, tx?: Transaction): Promise<readonly RiskScoringRule[]>;
  findById(id: RiskScoringRuleId, tx?: Transaction): Promise<RiskScoringRule | null>;
  listByOrganization(organizationId: string, tx?: Transaction): Promise<readonly RiskScoringRule[]>;
  save(rule: RiskScoringRule, tx?: Transaction): Promise<void>;
}
