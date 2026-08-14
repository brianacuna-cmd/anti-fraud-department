import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { CaseRoutingRule } from '../domain/model/aggregates/CaseRoutingRule.js';
import { createCaseRoutingRuleId } from '../domain/model/value-objects/CaseRoutingRuleId.js';
import type { CaseRoutingRuleRepository } from '../domain/ports/CaseRoutingRuleRepository.js';
import {
  forbiddenCrossTenant,
  routingRuleNotFound,
} from '../domain/errors/CaseManagementError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireRole } from './authorization/requireRole.js';

const ROUTING_RULE_READ_ROLES = ['SUPERVISOR', 'ADMIN', 'AUDITOR'] as const;

export interface GetRoutingRuleInput {
  readonly auth: AuthContext;
  readonly ruleId: string;
}

export interface GetRoutingRuleDeps {
  readonly routingRules: CaseRoutingRuleRepository;
}

/** Loads a routing rule by id; SUPERVISOR|ADMIN|AUDITOR; tenant-scoped. */
export function createGetRoutingRuleUseCase(deps: GetRoutingRuleDeps) {
  return async function getRoutingRule(input: GetRoutingRuleInput): Promise<CaseRoutingRule> {
    requireRole(input.auth, ROUTING_RULE_READ_ROLES);
    const organizationId = requireTenantContext(input.auth);
    const ruleId = createCaseRoutingRuleId(input.ruleId);
    const rule = await deps.routingRules.findById(ruleId);
    if (rule === null) {
      throw routingRuleNotFound(ruleId);
    }
    if (rule.organizationId !== organizationId) {
      throw forbiddenCrossTenant('routing rule does not belong to the actor organization');
    }
    return rule;
  };
}
