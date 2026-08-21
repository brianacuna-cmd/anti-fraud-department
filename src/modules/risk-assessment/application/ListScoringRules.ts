import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { RiskScoringRule } from '../domain/model/aggregates/RiskScoringRule.js';
import type { RiskScoringRuleRepository } from '../domain/ports/RiskScoringRuleRepository.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireReadRole, SCORING_RULE_READ_ROLES } from './authorization/policy.js';

export interface ListScoringRulesInput {
  readonly auth: AuthContext;
}

export interface ListScoringRulesDeps {
  readonly scoringRules: RiskScoringRuleRepository;
}

/** Lists ACTIVE + INACTIVE scoring rules for the caller's organization. */
export function createListScoringRulesUseCase(deps: ListScoringRulesDeps) {
  return async function listScoringRules(input: ListScoringRulesInput): Promise<readonly RiskScoringRule[]> {
    requireReadRole(input.auth, SCORING_RULE_READ_ROLES);
    const organizationId = requireTenantContext(input.auth);
    return deps.scoringRules.listByOrganization(organizationId);
  };
}
