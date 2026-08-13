import type { CaseRoutingRule } from '../../../src/modules/case-management/domain/model/aggregates/CaseRoutingRule.js';
import type { CaseRoutingRuleRepository } from '../../../src/modules/case-management/domain/ports/CaseRoutingRuleRepository.js';
import type { Transaction } from '../../../src/modules/case-management/domain/ports/UnitOfWork.js';

/**
 * In-memory `CaseRoutingRuleRepository` fake. `findActiveByOrganization`
 * mirrors the Mongo adapter: only ACTIVE rules for the org, ordered by
 * `createdAt` ascending (first-match-wins determinism).
 */
export class InMemoryCaseRoutingRuleRepository implements CaseRoutingRuleRepository {
  private readonly rules: CaseRoutingRule[] = [];

  add(rule: CaseRoutingRule): void {
    this.rules.push(rule);
  }

  async findActiveByOrganization(
    organizationId: string,
    _tx?: Transaction,
  ): Promise<readonly CaseRoutingRule[]> {
    return this.rules
      .filter((rule) => rule.organizationId === organizationId && rule.status === 'ACTIVE')
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  }
}
