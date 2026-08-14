import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { RiskScoringRule } from '../domain/model/aggregates/RiskScoringRule.js';
import { createRiskScoringRuleId } from '../domain/model/value-objects/RiskScoringRuleId.js';
import type { RiskScoringRuleRepository } from '../domain/ports/RiskScoringRuleRepository.js';
import {
  forbiddenCrossTenant,
  scoringRuleByIdNotFound,
} from '../domain/errors/RiskAssessmentError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireRole } from './authorization/requireRole.js';

const SCORING_RULE_ROLES = ['SUPERVISOR', 'ADMIN'] as const;

export interface GetScoringRuleInput {
  readonly auth: AuthContext;
  readonly ruleId: string;
}

export interface GetScoringRuleDeps {
  readonly scoringRules: RiskScoringRuleRepository;
}

/** Loads a scoring rule by id; SUPERVISOR|ADMIN; tenant-scoped. */
export function createGetScoringRuleUseCase(deps: GetScoringRuleDeps) {
  return async function getScoringRule(input: GetScoringRuleInput): Promise<RiskScoringRule> {
    requireRole(input.auth, SCORING_RULE_ROLES);
    const organizationId = requireTenantContext(input.auth);
    const ruleId = createRiskScoringRuleId(input.ruleId);
    const rule = await deps.scoringRules.findById(ruleId);
    if (rule === null) {
      throw scoringRuleByIdNotFound(ruleId);
    }
    if (rule.organizationId !== organizationId) {
      throw forbiddenCrossTenant('scoring rule does not belong to the actor organization');
    }
    return rule;
  };
}
