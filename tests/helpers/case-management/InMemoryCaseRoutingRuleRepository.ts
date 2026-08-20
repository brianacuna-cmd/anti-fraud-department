import type { CaseRoutingRule } from '../../../src/modules/case-management/domain/model/aggregates/CaseRoutingRule.js';
import type { CaseRoutingRuleId } from '../../../src/modules/case-management/domain/model/value-objects/CaseRoutingRuleId.js';
import type { CaseRoutingRuleRepository } from '../../../src/modules/case-management/domain/ports/CaseRoutingRuleRepository.js';
import type { Transaction } from '../../../src/modules/case-management/domain/ports/UnitOfWork.js';

/**
 * In-memory `CaseRoutingRuleRepository` fake. `findActiveByOrganization`
 * mirrors the Mongo adapter: only ACTIVE rules for the org, ordered by
 * `createdAt` ascending (first-match-wins determinism). Draft CRUD uses
 * save / findById / listByOrganization.
 */
export class InMemoryCaseRoutingRuleRepository implements CaseRoutingRuleRepository {
  private readonly rules: CaseRoutingRule[] = [];

  add(rule: CaseRoutingRule): void {
    this.rules.push(rule);
  }

  all(): readonly CaseRoutingRule[] {
    return [...this.rules];
  }

  async findActiveByOrganization(
    organizationId: string,
    _tx?: Transaction,
  ): Promise<readonly CaseRoutingRule[]> {
    return this.rules
      .filter((rule) => rule.organizationId === organizationId && rule.status === 'ACTIVE')
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  }

  async findById(id: CaseRoutingRuleId, _tx?: Transaction): Promise<CaseRoutingRule | null> {
    return this.rules.find((rule) => rule.id === id) ?? null;
  }

  async listByOrganization(organizationId: string, _tx?: Transaction): Promise<readonly CaseRoutingRule[]> {
    return this.rules
      .filter((rule) => rule.organizationId === organizationId)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  }

  async save(rule: CaseRoutingRule, _tx?: Transaction): Promise<void> {
    const index = this.rules.findIndex((existing) => existing.id === rule.id);
    if (index >= 0) {
      this.rules[index] = rule;
    } else {
      this.rules.push(rule);
    }
  }
}
