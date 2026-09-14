import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { RiskScoringRule } from '../domain/model/aggregates/RiskScoringRule.js';
import { createRiskScoringRuleId } from '../domain/model/value-objects/RiskScoringRuleId.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { RiskScoringRuleRepository } from '../domain/ports/RiskScoringRuleRepository.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import { forbiddenCrossTenant, scoringRuleByIdNotFound } from '../domain/errors/RiskAssessmentError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireRuleAuthoringRole } from './authorization/policy.js';

export interface UpdateScoringRuleInput {
  readonly auth: AuthContext;
  readonly ruleId: string;
  readonly name?: string;
  readonly conditions?: Readonly<Record<string, unknown>>;
}

export interface UpdateScoringRuleDeps {
  readonly scoringRules: RiskScoringRuleRepository;
  readonly auditRecorder: AuditRecorder;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
}

function isUnchangedPatch(existing: RiskScoringRule, input: UpdateScoringRuleInput): boolean {
  const nextName = input.name ?? existing.name;
  const nextConditions = input.conditions ?? existing.conditions;
  return (
    nextName === existing.name && JSON.stringify(nextConditions) === JSON.stringify(existing.conditions)
  );
}

/**
 * SUPERVISOR/ORGANIZATION patch of name and/or conditions. Status is not
 * patchable. Find runs inside the unit of work. Cross-tenant is 403.
 * Unchanged PATCH is a no-op: no save, no audit, no updatedAt bump.
 */
export function createUpdateScoringRuleUseCase(deps: UpdateScoringRuleDeps) {
  return async function updateScoringRule(input: UpdateScoringRuleInput): Promise<RiskScoringRule> {
    requireRuleAuthoringRole(input.auth);
    const organizationId = requireTenantContext(input.auth);
    const ruleId = createRiskScoringRuleId(input.ruleId);

    return deps.unitOfWork.withTransaction(async (tx) => {
      const existing = await deps.scoringRules.findById(ruleId, tx);
      if (existing === null) {
        throw scoringRuleByIdNotFound(ruleId);
      }
      if (existing.organizationId !== organizationId) {
        throw forbiddenCrossTenant('the scoring rule does not belong to the actor organization');
      }
      if (isUnchangedPatch(existing, input)) {
        return existing;
      }

      const now = deps.clock.now();
      const updated = existing.update(
        {
          name: input.name,
          conditions: input.conditions,
        },
        now,
      );
      await deps.scoringRules.save(updated, tx);

      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: 'UPDATE_SCORING_RULE',
          resource: 'rule',
          resourceId: updated.id,
          detail: {
            name: updated.name,
            conditionsVersion: updated.conditionsVersion,
            status: updated.status,
          },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );

      return updated;
    });
  };
}
