import { oid } from '../../../support/oid.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createListRoutingRulesUseCase } from '../../../../src/modules/case-management/application/ListRoutingRules.js';
import { createGetRoutingRuleUseCase } from '../../../../src/modules/case-management/application/GetRoutingRule.js';
import { CaseRoutingRule } from '../../../../src/modules/case-management/domain/model/aggregates/CaseRoutingRule.js';
import { generateCaseRoutingRuleId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseRoutingRuleId.js';
import { CaseManagementError } from '../../../../src/modules/case-management/domain/errors/CaseManagementError.js';
import { InMemoryCaseRoutingRuleRepository } from '../../../helpers/case-management/InMemoryCaseRoutingRuleRepository.js';

const ORG = oid('org-1');
const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

function buildRule(status: 'ACTIVE' | 'INACTIVE', name: string, organizationId = ORG): CaseRoutingRule {
  return CaseRoutingRule.create({
    id: generateCaseRoutingRuleId(),
    organizationId,
    name,
    conditions: {
      contentType: 'application/vnd.gorules.decision',
      nodes: [{ id: 'n1', type: 'inputNode' }],
      edges: [],
    },
    conditionsVersion: 1,
    status,
    now: NOW,
  });
}

function auth(roleId: string | null = 'SUPERVISOR') {
  return createAuthContext({
    userId: oid('user-1'),
    organizationId: ORG,
    roleId,
  });
}

describe('ListRoutingRules / GetRoutingRule', () => {
  it('lists ACTIVE and INACTIVE rules for the organization', async () => {
    const routingRules = new InMemoryCaseRoutingRuleRepository();
    routingRules.add(buildRule('ACTIVE', 'live'));
    routingRules.add(buildRule('INACTIVE', 'draft'));
    routingRules.add(buildRule('ACTIVE', 'other', oid('org-2')));

    const list = createListRoutingRulesUseCase({ routingRules });
    const items = await list({ auth: auth() });

    expect(items.map((r) => r.name).sort()).toEqual(['draft', 'live']);
  });

  it('allows AUDITOR to list', async () => {
    const routingRules = new InMemoryCaseRoutingRuleRepository();
    routingRules.add(buildRule('INACTIVE', 'draft'));

    const list = createListRoutingRulesUseCase({ routingRules });
    const items = await list({ auth: auth('AUDITOR') });

    expect(items).toHaveLength(1);
    expect(items[0]?.name).toBe('draft');
  });

  it('rejects ANALYST on list', async () => {
    const list = createListRoutingRulesUseCase({
      routingRules: new InMemoryCaseRoutingRuleRepository(),
    });

    try {
      await list({ auth: auth('ANALYST') });
      throw new Error('expected list to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(CaseManagementError);
      expect((error as CaseManagementError).code).toBe('FORBIDDEN_ROLE');
    }
  });

  it('gets a rule by id within the tenant', async () => {
    const routingRules = new InMemoryCaseRoutingRuleRepository();
    const draft = buildRule('INACTIVE', 'draft');
    routingRules.add(draft);

    const get = createGetRoutingRuleUseCase({ routingRules });
    const found = await get({ auth: auth('ADMIN'), ruleId: draft.id });

    expect(found.id).toBe(draft.id);
    expect(found.name).toBe('draft');
  });

  it('allows AUDITOR to get by id', async () => {
    const routingRules = new InMemoryCaseRoutingRuleRepository();
    const draft = buildRule('INACTIVE', 'draft');
    routingRules.add(draft);

    const get = createGetRoutingRuleUseCase({ routingRules });
    const found = await get({ auth: auth('AUDITOR'), ruleId: draft.id });

    expect(found.id).toBe(draft.id);
  });

  it('rejects cross-tenant get', async () => {
    const routingRules = new InMemoryCaseRoutingRuleRepository();
    const other = buildRule('INACTIVE', 'other', oid('org-2'));
    routingRules.add(other);

    const get = createGetRoutingRuleUseCase({ routingRules });

    try {
      await get({ auth: auth(), ruleId: other.id });
      throw new Error('expected get to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(CaseManagementError);
      expect((error as CaseManagementError).code).toBe('FORBIDDEN_CROSS_TENANT');
    }
  });

  it('rejects get when rule is missing', async () => {
    const get = createGetRoutingRuleUseCase({
      routingRules: new InMemoryCaseRoutingRuleRepository(),
    });
    const missingId = generateCaseRoutingRuleId();

    try {
      await get({ auth: auth(), ruleId: missingId });
      throw new Error('expected get to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(CaseManagementError);
      expect((error as CaseManagementError).code).toBe('ROUTING_RULE_NOT_FOUND');
    }
  });
});
