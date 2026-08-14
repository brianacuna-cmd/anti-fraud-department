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

export interface ActivateRoutingRuleInput {
  readonly auth: AuthContext;
  readonly ruleId: string;
}

export interface ActivateRoutingRuleDeps {
  readonly routingRules: CaseRoutingRuleRepository;
  readonly auditRecorder: AuditRecorder;
  readonly clock: Clock;
}

/**
 * Non-exclusive activate: flips one INACTIVE draft to ACTIVE.
 * Sibling ACTIVE rules remain ACTIVE (contrast ActivateScoringRule).
 * Single-document update — no UnitOfWork / exclusive swap.
 * SUPERVISOR|ADMIN only.
 */
export function createActivateRoutingRuleUseCase(deps: ActivateRoutingRuleDeps) {
  return async function activateRoutingRule(input: ActivateRoutingRuleInput): Promise<CaseRoutingRule> {
    requireRole(input.auth, ROUTING_RULE_WRITE_ROLES);
    const organizationId = requireTenantContext(input.auth);
    const ruleId = createCaseRoutingRuleId(input.ruleId);

    const draft = await deps.routingRules.findById(ruleId);
    if (draft === null) {
      throw routingRuleNotFound(ruleId);
    }
    if (draft.organizationId !== organizationId) {
      throw forbiddenCrossTenant('routing rule does not belong to the actor organization');
    }

    const now = deps.clock.now();
    const activated = draft.status === 'ACTIVE' ? draft : draft.activate(now);
    if (activated !== draft) {
      await deps.routingRules.save(activated);
    }

    await deps.auditRecorder.record({
      organizationId,
      actorType: input.auth.actorType,
      actorId: input.auth.userId,
      action: 'ACTIVATE_ROUTING_RULE',
      resource: 'rule',
      resourceId: activated.id,
      detail: {
        name: activated.name,
        previousStatus: draft.status,
      },
      ipAddress: input.auth.ipAddress,
    });

    return activated;
  };
}
