import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { CaseRoutingRule } from '../domain/model/aggregates/CaseRoutingRule.js';
import { createCaseRoutingRuleId } from '../domain/model/value-objects/CaseRoutingRuleId.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { CaseRoutingRuleRepository } from '../domain/ports/CaseRoutingRuleRepository.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import {
  forbiddenCrossTenant,
  routingRuleActive,
  routingRuleNotFound,
} from '../domain/errors/CaseManagementError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireRuleAuthoringRole } from './authorization/policy.js';

export interface DeleteRoutingRuleInput {
  readonly auth: AuthContext;
  readonly ruleId: string;
}

export interface DeleteRoutingRuleDeps {
  readonly routingRules: CaseRoutingRuleRepository;
  readonly auditRecorder: AuditRecorder;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
}

/**
 * DELETE /case-routing-rules/:id — logical (soft) delete. SUPERVISOR only.
 * Never hard-deleted: routing decisions on frozen case snapshots keep the
 * `ruleId` that fired, so the row must survive. Rejects an ACTIVE rule
 * (`ROUTING_RULE_ACTIVE`, 409) — deactivate it first, so the change of who
 * gets the next case is on record as such and not as a disappearance.
 * Idempotent: re-deleting an already-deleted rule is a no-op.
 */
export function createDeleteRoutingRuleUseCase(deps: DeleteRoutingRuleDeps) {
  return async function deleteRoutingRule(input: DeleteRoutingRuleInput): Promise<CaseRoutingRule> {
    requireRuleAuthoringRole(input.auth);
    const organizationId = requireTenantContext(input.auth);
    const ruleId = createCaseRoutingRuleId(input.ruleId);

    const rule = await deps.routingRules.findById(ruleId);
    if (rule === null) {
      throw routingRuleNotFound(ruleId);
    }
    if (rule.organizationId !== organizationId) {
      throw forbiddenCrossTenant('routing rule does not belong to the actor organization');
    }
    if (rule.deletedAt !== null) {
      return rule;
    }
    if (rule.status === 'ACTIVE') {
      throw routingRuleActive(ruleId);
    }

    const now = deps.clock.now();
    const deleted = rule.softDelete(now);

    return deps.unitOfWork.withTransaction(async (tx) => {
      await deps.routingRules.save(deleted, tx);

      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: 'DELETE_ROUTING_RULE',
          resource: 'rule',
          resourceId: deleted.id,
          detail: { name: deleted.name },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );

      return deleted;
    });
  };
}
