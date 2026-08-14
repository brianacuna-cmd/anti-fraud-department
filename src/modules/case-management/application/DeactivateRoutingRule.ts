import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { CaseRoutingRule } from '../domain/model/aggregates/CaseRoutingRule.js';
import { createCaseRoutingRuleId } from '../domain/model/value-objects/CaseRoutingRuleId.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { CaseRoutingRuleRepository } from '../domain/ports/CaseRoutingRuleRepository.js';
import {
  forbiddenCrossTenant,
  routingRuleNotFound,
} from '../domain/errors/CaseManagementError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireRole } from './authorization/requireRole.js';

const ROUTING_RULE_WRITE_ROLES = ['SUPERVISOR', 'ADMIN'] as const;

export interface DeactivateRoutingRuleInput {
  readonly auth: AuthContext;
  readonly ruleId: string;
}

export interface DeactivateRoutingRuleDeps {
  readonly routingRules: CaseRoutingRuleRepository;
  readonly auditRecorder: AuditRecorder;
  readonly clock: Clock;
}

/**
 * Deactivates one ACTIVE rule to INACTIVE without affecting siblings.
 * Single-document update — no UnitOfWork. SUPERVISOR|ADMIN only.
 */
export function createDeactivateRoutingRuleUseCase(deps: DeactivateRoutingRuleDeps) {
  return async function deactivateRoutingRule(
    input: DeactivateRoutingRuleInput,
  ): Promise<CaseRoutingRule> {
    requireRole(input.auth, ROUTING_RULE_WRITE_ROLES);
    const organizationId = requireTenantContext(input.auth);
    const ruleId = createCaseRoutingRuleId(input.ruleId);

    const rule = await deps.routingRules.findById(ruleId);
    if (rule === null) {
      throw routingRuleNotFound(ruleId);
    }
    if (rule.organizationId !== organizationId) {
      throw forbiddenCrossTenant('routing rule does not belong to the actor organization');
    }

    const now = deps.clock.now();
    const deactivated = rule.status === 'INACTIVE' ? rule : rule.deactivate(now);
    if (deactivated !== rule) {
      await deps.routingRules.save(deactivated);
    }

    await deps.auditRecorder.record({
      organizationId,
      actorType: input.auth.actorType,
      actorId: input.auth.userId,
      action: 'DEACTIVATE_ROUTING_RULE',
      resource: 'rule',
      resourceId: deactivated.id,
      detail: {
        name: deactivated.name,
        previousStatus: rule.status,
      },
      ipAddress: input.auth.ipAddress,
    });

    return deactivated;
  };
}
