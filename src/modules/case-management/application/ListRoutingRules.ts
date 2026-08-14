import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { CaseRoutingRule } from '../domain/model/aggregates/CaseRoutingRule.js';
import type { CaseRoutingRuleRepository } from '../domain/ports/CaseRoutingRuleRepository.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireRole } from './authorization/requireRole.js';

const ROUTING_RULE_READ_ROLES = ['SUPERVISOR', 'ADMIN', 'AUDITOR'] as const;

export interface ListRoutingRulesInput {
  readonly auth: AuthContext;
}

export interface ListRoutingRulesDeps {
  readonly routingRules: CaseRoutingRuleRepository;
}

/** Lists ACTIVE + INACTIVE routing rules for the caller's organization. */
export function createListRoutingRulesUseCase(deps: ListRoutingRulesDeps) {
  return async function listRoutingRules(input: ListRoutingRulesInput): Promise<readonly CaseRoutingRule[]> {
    requireRole(input.auth, ROUTING_RULE_READ_ROLES);
    const organizationId = requireTenantContext(input.auth);
    return deps.routingRules.listByOrganization(organizationId);
  };
}
