import type { CaseRoutingRule } from '../../../src/modules/case-management/domain/model/aggregates/CaseRoutingRule.js';
import type { CaseRoutingRuleId } from '../../../src/modules/case-management/domain/model/value-objects/CaseRoutingRuleId.js';
import type { CaseRoutingRuleRepository } from '../../../src/modules/case-management/domain/ports/CaseRoutingRuleRepository.js';
import type { Transaction } from '../../../src/modules/case-management/domain/ports/UnitOfWork.js';

/**
 * In-memory `CaseRoutingRuleRepository` fake. `findActiveByOrganization`
 * and `listByOrganization` mirror Mongo: `executionOrder` ASC then
 * `createdAt` ASC (first-match-wins determinism). Draft CRUD uses
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
      .sort(compareCatalogOrder);
  }

  async findById(id: CaseRoutingRuleId, _tx?: Transaction): Promise<CaseRoutingRule | null> {
    return this.rules.find((rule) => rule.id === id) ?? null;
  }

  async listByOrganization(organizationId: string, _tx?: Transaction): Promise<readonly CaseRoutingRule[]> {
    return this.rules.filter((rule) => rule.organizationId === organizationId).sort(compareCatalogOrder);
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

function compareCatalogOrder(a: CaseRoutingRule, b: CaseRoutingRule): number {
  if (a.executionOrder !== b.executionOrder) {
    return a.executionOrder - b.executionOrder;
  }
  if (a.createdAt < b.createdAt) {
    return -1;
  }
  if (a.createdAt > b.createdAt) {
    return 1;
  }
  return 0;
}
