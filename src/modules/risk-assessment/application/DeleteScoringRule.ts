import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { RiskScoringRule } from '../domain/model/aggregates/RiskScoringRule.js';
import { createRiskScoringRuleId } from '../domain/model/value-objects/RiskScoringRuleId.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { RiskScoringRuleRepository } from '../domain/ports/RiskScoringRuleRepository.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import { forbiddenCrossTenant, scoringRuleByIdNotFound } from '../domain/errors/RiskAssessmentError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireOperationalRole, SCORING_RULE_WRITE_ROLES } from './authorization/policy.js';

export interface DeleteScoringRuleInput {
  readonly auth: AuthContext;
  readonly ruleId: string;
}

export interface DeleteScoringRuleDeps {
  readonly scoringRules: RiskScoringRuleRepository;
  readonly auditRecorder: AuditRecorder;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
}

/**
 * Removes a scoring rule from the list.
 *
 * Soft delete, not an erase: cases carry `ruleId` and `conditionsVersion` in
 * their frozen snapshot, so a deleted row still has to be there when someone
 * asks which rule opened a case. `RiskScoringRule.delete` is what refuses to
 * touch the ACTIVE one — that check lives in the aggregate because there is
 * one path to deletion and putting it anywhere else is a check that can
 * someday be bypassed.
 */
export function createDeleteScoringRuleUseCase(deps: DeleteScoringRuleDeps) {
  return async function deleteScoringRule(input: DeleteScoringRuleInput): Promise<RiskScoringRule> {
    requireOperationalRole(input.auth, SCORING_RULE_WRITE_ROLES);
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

      const now = deps.clock.now();
      const deleted = existing.delete(now);
      await deps.scoringRules.save(deleted, tx);

      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: 'DELETE_SCORING_RULE',
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
