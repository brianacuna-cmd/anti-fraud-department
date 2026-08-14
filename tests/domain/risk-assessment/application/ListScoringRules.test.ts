import { oid } from '../../../support/oid.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createListScoringRulesUseCase } from '../../../../src/modules/risk-assessment/application/ListScoringRules.js';
import { createGetScoringRuleUseCase } from '../../../../src/modules/risk-assessment/application/GetScoringRule.js';
import { RiskScoringRule } from '../../../../src/modules/risk-assessment/domain/model/aggregates/RiskScoringRule.js';
import { generateRiskScoringRuleId } from '../../../../src/modules/risk-assessment/domain/model/value-objects/RiskScoringRuleId.js';
import { RiskAssessmentError } from '../../../../src/modules/risk-assessment/domain/errors/RiskAssessmentError.js';
import { InMemoryRiskScoringRuleRepository } from '../../../helpers/risk-assessment/InMemoryRiskScoringRuleRepository.js';

const ORG = oid('org-1');
const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

function buildRule(status: 'ACTIVE' | 'INACTIVE', name: string, organizationId = ORG): RiskScoringRule {
  return RiskScoringRule.create({
    id: generateRiskScoringRuleId(),
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

function supervisorAuth(roleId: string | null = 'SUPERVISOR') {
  return createAuthContext({
    userId: oid('user-1'),
    organizationId: ORG,
    roleId,
  });
}

describe('ListScoringRules / GetScoringRule', () => {
  it('lists ACTIVE and INACTIVE rules for the organization', async () => {
    const scoringRules = new InMemoryRiskScoringRuleRepository();
    scoringRules.add(buildRule('ACTIVE', 'live'));
    scoringRules.add(buildRule('INACTIVE', 'draft'));
    scoringRules.add(buildRule('ACTIVE', 'other', oid('org-2')));

    const list = createListScoringRulesUseCase({ scoringRules });
    const items = await list({ auth: supervisorAuth() });

    expect(items.map((r) => r.name).sort()).toEqual(['draft', 'live']);
  });

  it('rejects ANALYST on list', async () => {
    const list = createListScoringRulesUseCase({
      scoringRules: new InMemoryRiskScoringRuleRepository(),
    });

    try {
      await list({ auth: supervisorAuth('ANALYST') });
      throw new Error('expected list to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(RiskAssessmentError);
      expect((error as RiskAssessmentError).code).toBe('FORBIDDEN_ROLE');
    }
  });

  it('gets a rule by id within the tenant', async () => {
    const scoringRules = new InMemoryRiskScoringRuleRepository();
    const draft = buildRule('INACTIVE', 'draft');
    scoringRules.add(draft);

    const get = createGetScoringRuleUseCase({ scoringRules });
    const found = await get({ auth: supervisorAuth('ADMIN'), ruleId: draft.id });

    expect(found.id).toBe(draft.id);
    expect(found.name).toBe('draft');
  });

  it('rejects cross-tenant get', async () => {
    const scoringRules = new InMemoryRiskScoringRuleRepository();
    const other = buildRule('INACTIVE', 'other', oid('org-2'));
    scoringRules.add(other);

    const get = createGetScoringRuleUseCase({ scoringRules });

    try {
      await get({ auth: supervisorAuth(), ruleId: other.id });
      throw new Error('expected get to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(RiskAssessmentError);
      expect((error as RiskAssessmentError).code).toBe('FORBIDDEN_CROSS_TENANT');
    }
  });
});
