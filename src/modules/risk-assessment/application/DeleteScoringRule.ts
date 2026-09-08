import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { RiskScoringRule } from '../domain/model/aggregates/RiskScoringRule.js';
import { createRiskScoringRuleId } from '../domain/model/value-objects/RiskScoringRuleId.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { RiskScoringRuleRepository } from '../domain/ports/RiskScoringRuleRepository.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import {
  forbiddenCrossTenant,
  scoringRuleActive,
  scoringRuleByIdNotFound,
} from '../domain/errors/RiskAssessmentError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireRuleAuthoringRole } from './authorization/policy.js';

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
 * DELETE /risk-scoring-rules/:id — logical (soft) delete. SUPERVISOR only.
 * Never hard-deleted: frozen case snapshots keep the `ruleId` that scored
 * them. Rejects an ACTIVE rule (`SCORING_RULE_ACTIVE`, 409) — activate
 * another rule to relieve it first (mirrors `ActivateScoringRule`'s
 * relieve semantics), so the change is on record as such and not as a
 * disappearance. Idempotent: re-deleting an already-deleted rule is a no-op.
 */
export function createDeleteScoringRuleUseCase(deps: DeleteScoringRuleDeps) {
  return async function deleteScoringRule(input: DeleteScoringRuleInput): Promise<RiskScoringRule> {
    requireRuleAuthoringRole(input.auth);
    const organizationId = requireTenantContext(input.auth);
    const ruleId = createRiskScoringRuleId(input.ruleId);

    const rule = await deps.scoringRules.findById(ruleId);
    if (rule === null) {
      throw scoringRuleByIdNotFound(ruleId);
    }
    if (rule.organizationId !== organizationId) {
      throw forbiddenCrossTenant('scoring rule does not belong to the actor organization');
    }
    if (rule.deletedAt !== null) {
      return rule;
    }
    if (rule.status === 'ACTIVE') {
      throw scoringRuleActive(ruleId);
    }

    const now = deps.clock.now();
    const deleted = rule.softDelete(now);

    return deps.unitOfWork.withTransaction(async (tx) => {
      await deps.scoringRules.save(deleted, tx);

      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: 'DELETE_SCORING_RULE',
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
