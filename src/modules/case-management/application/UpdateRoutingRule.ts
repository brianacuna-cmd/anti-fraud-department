import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { CaseRoutingRule } from '../domain/model/aggregates/CaseRoutingRule.js';
import { createCaseRoutingRuleId } from '../domain/model/value-objects/CaseRoutingRuleId.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { CaseRoutingRuleRepository } from '../domain/ports/CaseRoutingRuleRepository.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import {
  forbiddenCrossTenant,
  routingRuleNotFound,
} from '../domain/errors/CaseManagementError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireOperationalRole, SUPERVISION_ROLES } from './authorization/policy.js';

export interface UpdateRoutingRuleInput {
  readonly auth: AuthContext;
  readonly ruleId: string;
  readonly name?: string;
  readonly conditions?: Readonly<Record<string, unknown>>;
  readonly targetRoleId?: string | null;
  readonly targetUserId?: string | null;
}

export interface UpdateRoutingRuleDeps {
  readonly routingRules: CaseRoutingRuleRepository;
  readonly auditRecorder: AuditRecorder;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
}

function isUnchangedPatch(
  existing: CaseRoutingRule,
  input: UpdateRoutingRuleInput,
): boolean {
  const nextName = input.name ?? existing.name;
  const nextConditions = input.conditions ?? existing.conditions;
  const nextTargetRoleId = input.targetRoleId !== undefined ? input.targetRoleId : existing.targetRoleId;
  const nextTargetUserId = input.targetUserId !== undefined ? input.targetUserId : existing.targetUserId;
  return (
    nextName === existing.name &&
    JSON.stringify(nextConditions) === JSON.stringify(existing.conditions) &&
    nextTargetRoleId === existing.targetRoleId &&
    nextTargetUserId === existing.targetUserId
  );
}

/**
 * SUPERVISOR-only patch of name, conditions, and/or targets. Status is not
 * patchable. Find runs inside the unit of work (webhook shape). Cross-tenant
 * is 403, matching Get/ActivateRoutingRule. Unchanged PATCH is a no-op:
 * no save, no audit, no updatedAt bump.
 */
export function createUpdateRoutingRuleUseCase(deps: UpdateRoutingRuleDeps) {
  return async function updateRoutingRule(input: UpdateRoutingRuleInput): Promise<CaseRoutingRule> {
    requireOperationalRole(input.auth, SUPERVISION_ROLES);
    const organizationId = requireTenantContext(input.auth);
    const ruleId = createCaseRoutingRuleId(input.ruleId);

    return deps.unitOfWork.withTransaction(async (tx) => {
      const existing = await deps.routingRules.findById(ruleId, tx);
      if (existing === null) {
        throw routingRuleNotFound(ruleId);
      }
      if (existing.organizationId !== organizationId) {
        throw forbiddenCrossTenant('routing rule does not belong to the actor organization');
      }
      if (isUnchangedPatch(existing, input)) {
        return existing;
      }

      const now = deps.clock.now();
      const updated = existing.update(
        {
          name: input.name,
          conditions: input.conditions,
          targetRoleId: input.targetRoleId,
          targetUserId: input.targetUserId,
        },
        now,
      );
      await deps.routingRules.save(updated, tx);

      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: 'UPDATE_ROUTING_RULE',
          resource: 'rule',
          resourceId: updated.id,
          detail: {
            name: updated.name,
            conditionsVersion: updated.conditionsVersion,
            status: updated.status,
            targetRoleId: updated.targetRoleId,
            targetUserId: updated.targetUserId,
          },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );

      return updated;
    });
  };
}
