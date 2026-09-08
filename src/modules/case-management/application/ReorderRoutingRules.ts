import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { CaseRoutingRule } from '../domain/model/aggregates/CaseRoutingRule.js';
import { createCaseRoutingRuleId } from '../domain/model/value-objects/CaseRoutingRuleId.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { CaseRoutingRuleRepository } from '../domain/ports/CaseRoutingRuleRepository.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import { forbiddenCrossTenant, invariantViolation } from '../domain/errors/CaseManagementError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireOperationalRole, SUPERVISION_ROLES } from './authorization/policy.js';

export interface ReorderRoutingRulesInput {
  readonly auth: AuthContext;
  readonly ids: readonly string[];
}

export interface ReorderRoutingRulesDeps {
  readonly routingRules: CaseRoutingRuleRepository;
  readonly auditRecorder: AuditRecorder;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
}

/**
 * SUPERVISOR-only full-org permutation. `ids` must be exactly the tenant's
 * catalog (ACTIVE + INACTIVE). Rewrites `executionOrder` to `0..n-1`.
 * Identity order is a no-op. Cross-tenant ids are 403; any other mismatch
 * is 400. Audit uses null `resourceId` and `detail.ids`.
 */
export function createReorderRoutingRulesUseCase(deps: ReorderRoutingRulesDeps) {
  return async function reorderRoutingRules(
    input: ReorderRoutingRulesInput,
  ): Promise<readonly CaseRoutingRule[]> {
    requireOperationalRole(input.auth, SUPERVISION_ROLES);
    const organizationId = requireTenantContext(input.auth);
    const requested = input.ids.map(createCaseRoutingRuleId);
    const unique = new Set(requested);
    if (unique.size !== requested.length) {
      throw invariantViolation('ids must be a full permutation of the organization routing rules', {
        ids: input.ids,
      });
    }

    return deps.unitOfWork.withTransaction(async (tx) => {
      const listed = await deps.routingRules.listByOrganization(organizationId, tx);
      for (const id of requested) {
        if (listed.some((rule) => rule.id === id)) {
          continue;
        }
        const found = await deps.routingRules.findById(id, tx);
        if (found !== null && found.organizationId !== organizationId) {
          throw forbiddenCrossTenant('routing rule does not belong to the actor organization');
        }
      }
      if (requested.length !== listed.length || listed.some((rule) => !unique.has(rule.id))) {
        throw invariantViolation('ids must be a full permutation of the organization routing rules', {
          ids: input.ids,
        });
      }
      if (requested.every((id, index) => listed[index]?.id === id)) {
        return listed;
      }

      const now = deps.clock.now();
      const byId = new Map(listed.map((rule) => [rule.id, rule]));
      const reordered = requested.map((id, index) => {
        const rule = byId.get(id);
        if (rule === undefined) {
          throw invariantViolation('ids must be a full permutation of the organization routing rules', {
            ids: input.ids,
          });
        }
        return rule.withExecutionOrder(index, now);
      });
      for (const rule of reordered) {
        await deps.routingRules.save(rule, tx);
      }
      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: 'REORDER_ROUTING_RULES',
          resource: 'rule',
          resourceId: null,
          detail: { ids: [...input.ids] },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );
      return reordered;
    });
  };
}
