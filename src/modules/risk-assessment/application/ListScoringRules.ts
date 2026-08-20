import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { RiskScoringRule } from '../domain/model/aggregates/RiskScoringRule.js';
import type { RiskScoringRuleRepository } from '../domain/ports/RiskScoringRuleRepository.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireRole } from './authorization/requireRole.js';

const SCORING_RULE_ROLES = ['SUPERVISOR', 'ADMIN'] as const;

export interface ListScoringRulesInput {
  readonly auth: AuthContext;
}

export interface ListScoringRulesDeps {
  readonly scoringRules: RiskScoringRuleRepository;
}

/** Lists ACTIVE + INACTIVE scoring rules for the caller's organization. */
export function createListScoringRulesUseCase(deps: ListScoringRulesDeps) {
  return async function listScoringRules(input: ListScoringRulesInput): Promise<readonly RiskScoringRule[]> {
    requireRole(input.auth, SCORING_RULE_ROLES);
    const organizationId = requireTenantContext(input.auth);
    return deps.scoringRules.listByOrganization(organizationId);
  };
}
