import { oid } from '../../../support/oid.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { CaseRoutingRule } from '../../../../src/modules/case-management/domain/model/aggregates/CaseRoutingRule.js';
import { generateCaseRoutingRuleId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseRoutingRuleId.js';
import { InMemoryCaseRoutingRuleRepository } from '../../../helpers/case-management/InMemoryCaseRoutingRuleRepository.js';

function buildRule(
  name: string,
  createdAt: string,
  overrides: { status?: 'ACTIVE' | 'INACTIVE'; executionOrder?: number } = {},
): CaseRoutingRule {
  return CaseRoutingRule.create({
    id: generateCaseRoutingRuleId(),
    organizationId: oid('org-1'),
    name,
    conditions: { nodes: [] },
    conditionsVersion: 1,
    status: overrides.status ?? 'ACTIVE',
    executionOrder: overrides.executionOrder,
    now: fromDate(new Date(createdAt)),
  });
}

describe('InMemoryCaseRoutingRuleRepository sort', () => {
  it('sorts findActive and list by executionOrder ASC then createdAt ASC', async () => {
    const routingRules = new InMemoryCaseRoutingRuleRepository();
    routingRules.add(buildRule('later-created-first-order', '2026-01-03T00:00:00.000Z', { executionOrder: 0 }));
    routingRules.add(buildRule('earlier-created-second-order', '2026-01-01T00:00:00.000Z', { executionOrder: 1 }));
    routingRules.add(buildRule('same-order-later', '2026-01-05T00:00:00.000Z', { executionOrder: 1 }));
    routingRules.add(buildRule('inactive', '2026-01-01T00:00:00.000Z', { status: 'INACTIVE', executionOrder: 0 }));

    const active = await routingRules.findActiveByOrganization(oid('org-1'));
    expect(active.map((rule) => rule.name)).toEqual([
      'later-created-first-order',
      'earlier-created-second-order',
      'same-order-later',
    ]);

    const listed = await routingRules.listByOrganization(oid('org-1'));
    expect(listed.map((rule) => rule.name)).toEqual([
      'inactive',
      'later-created-first-order',
      'earlier-created-second-order',
      'same-order-later',
    ]);
  });
});
