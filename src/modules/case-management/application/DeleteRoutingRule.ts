import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { CaseRoutingRule } from '../domain/model/aggregates/CaseRoutingRule.js';
import { createCaseRoutingRuleId } from '../domain/model/value-objects/CaseRoutingRuleId.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { CaseRoutingRuleRepository } from '../domain/ports/CaseRoutingRuleRepository.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import { forbiddenCrossTenant, routingRuleNotFound } from '../domain/errors/CaseManagementError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireOperationalRole, SUPERVISION_ROLES } from './authorization/policy.js';

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
 * Removes a routing rule from the list.
 *
 * Soft delete: `REASSIGN_CASE` audit rows name the winning rule by id, so the
 * row has to survive for "who decided this assignment?" to stay answerable.
 * `CaseRoutingRule.delete` refuses on an ACTIVE rule — deactivate it first, so
 * that a change in who gets the next case shows up as a routing change and
 * not as a deletion nobody connects to it.
 */
export function createDeleteRoutingRuleUseCase(deps: DeleteRoutingRuleDeps) {
  return async function deleteRoutingRule(input: DeleteRoutingRuleInput): Promise<CaseRoutingRule> {
    requireOperationalRole(input.auth, SUPERVISION_ROLES);
    const organizationId = requireTenantContext(input.auth);
    const ruleId = createCaseRoutingRuleId(input.ruleId);

    return deps.unitOfWork.withTransaction(async (tx) => {
      const existing = await deps.routingRules.findById(ruleId, tx);
      if (existing === null) {
        throw routingRuleNotFound(ruleId);
      }
      if (existing.organizationId !== organizationId) {
        throw forbiddenCrossTenant('the routing rule does not belong to the actor organization');
      }

      const now = deps.clock.now();
      const deleted = existing.delete(now);
      await deps.routingRules.save(deleted, tx);

      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: 'DELETE_ROUTING_RULE',
          resource: 'rule',
          resourceId: deleted.id,
          detail: { name: deleted.name, conditionsVersion: deleted.conditionsVersion },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );

      return deleted;
    });
  };
}
