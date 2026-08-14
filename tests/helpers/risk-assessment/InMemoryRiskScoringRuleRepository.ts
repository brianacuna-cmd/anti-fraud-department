import type { RiskScoringRule } from '../../../src/modules/risk-assessment/domain/model/aggregates/RiskScoringRule.js';
import type { RiskScoringRuleId } from '../../../src/modules/risk-assessment/domain/model/value-objects/RiskScoringRuleId.js';
import type { RiskScoringRuleRepository } from '../../../src/modules/risk-assessment/domain/ports/RiskScoringRuleRepository.js';
import type { Transaction } from '../../../src/modules/risk-assessment/domain/ports/UnitOfWork.js';

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

  async findActiveByOrganization(organizationId: string, _tx?: Transaction): Promise<readonly RiskScoringRule[]> {
    return this.rules
      .filter((rule) => rule.organizationId === organizationId && rule.status === 'ACTIVE')
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  }

  async findById(id: RiskScoringRuleId, _tx?: Transaction): Promise<RiskScoringRule | null> {
    return this.rules.find((rule) => rule.id === id) ?? null;
  }

  async listByOrganization(organizationId: string, _tx?: Transaction): Promise<readonly RiskScoringRule[]> {
    return this.rules
      .filter((rule) => rule.organizationId === organizationId)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  }

  async save(rule: RiskScoringRule, _tx?: Transaction): Promise<void> {
    const index = this.rules.findIndex((existing) => existing.id === rule.id);
    if (index >= 0) {
      this.rules[index] = rule;
    } else {
      this.rules.push(rule);
    }
  }
}
