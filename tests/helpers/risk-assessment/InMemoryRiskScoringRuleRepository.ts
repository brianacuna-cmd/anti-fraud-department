import type { RiskScoringRule } from '../../../src/modules/risk-assessment/domain/model/aggregates/RiskScoringRule.js';
import type { RiskScoringRuleRepository } from '../../../src/modules/risk-assessment/domain/ports/RiskScoringRuleRepository.js';

/**
 * In-memory `RiskScoringRuleRepository` fake. `findActiveByOrganization`
 * mirrors the Mongo adapter: only ACTIVE rules for the org. With the unique
 * partial ACTIVE index there is at most one; ordering is stable for fakes.
 */
export class InMemoryRiskScoringRuleRepository implements RiskScoringRuleRepository {
  private readonly rules: RiskScoringRule[] = [];

  add(rule: RiskScoringRule): void {
    this.rules.push(rule);
  }

  all(): readonly RiskScoringRule[] {
    return [...this.rules];
  }

  async findActiveByOrganization(organizationId: string): Promise<readonly RiskScoringRule[]> {
    return this.rules
      .filter((rule) => rule.organizationId === organizationId && rule.status === 'ACTIVE')
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  }
}
