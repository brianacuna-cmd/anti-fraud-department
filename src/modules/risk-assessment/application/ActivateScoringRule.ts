import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { RiskScoringRule } from '../domain/model/aggregates/RiskScoringRule.js';
import { createRiskScoringRuleId } from '../domain/model/value-objects/RiskScoringRuleId.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { RiskScoringRuleRepository } from '../domain/ports/RiskScoringRuleRepository.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import {
  forbiddenCrossTenant,
  scoringRuleByIdNotFound,
} from '../domain/errors/RiskAssessmentError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireOperationalRole, SCORING_RULE_WRITE_ROLES } from './authorization/policy.js';

export interface ActivateScoringRuleInput {
  readonly auth: AuthContext;
  readonly ruleId: string;
}

export interface ActivateScoringRuleDeps {
  readonly scoringRules: RiskScoringRuleRepository;
  readonly unitOfWork: UnitOfWork;
  readonly auditRecorder: AuditRecorder;
  readonly clock: Clock;
}

/**
 * Atomic activate: deactivate current ACTIVE (if any) and activate the draft
 * in one Unit of Work. SUPERVISOR only.
 */
export function createActivateScoringRuleUseCase(deps: ActivateScoringRuleDeps) {
  return async function activateScoringRule(input: ActivateScoringRuleInput): Promise<RiskScoringRule> {
    requireOperationalRole(input.auth, SCORING_RULE_WRITE_ROLES);
    const organizationId = requireTenantContext(input.auth);
    const ruleId = createRiskScoringRuleId(input.ruleId);

    return deps.unitOfWork.withTransaction(async (tx) => {
      const draft = await deps.scoringRules.findById(ruleId, tx);
      if (draft === null) {
        throw scoringRuleByIdNotFound(ruleId);
      }
      if (draft.organizationId !== organizationId) {
        throw forbiddenCrossTenant('scoring rule does not belong to the actor organization');
      }

      const now = deps.clock.now();
      const currentActive = await deps.scoringRules.findActiveByOrganization(organizationId, tx);
      for (const active of currentActive) {
        if (active.id === draft.id) {
          continue;
        }
        await deps.scoringRules.save(active.deactivate(now), tx);
      }

      const activated = draft.status === 'ACTIVE' ? draft : draft.activate(now);
      if (activated !== draft) {
        await deps.scoringRules.save(activated, tx);
      }

      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: 'ACTIVATE_SCORING_RULE',
          resource: 'rule',
          resourceId: activated.id,
          detail: {
            name: activated.name,
            previousActiveIds: currentActive.filter((r) => r.id !== activated.id).map((r) => r.id),
          },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );

      return activated;
    });
  };
}
