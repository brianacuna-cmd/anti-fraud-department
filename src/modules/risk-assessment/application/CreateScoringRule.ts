import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { RiskScoringRule } from '../domain/model/aggregates/RiskScoringRule.js';
import { RiskScoringRule as RiskScoringRuleAggregate } from '../domain/model/aggregates/RiskScoringRule.js';
import type { RiskScoringRuleId } from '../domain/model/value-objects/RiskScoringRuleId.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { RiskScoringRuleRepository } from '../domain/ports/RiskScoringRuleRepository.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireOperationalRole, SCORING_RULE_WRITE_ROLES } from './authorization/policy.js';

export interface CreateScoringRuleInput {
  readonly auth: AuthContext;
  readonly name: string;
  readonly conditions: Readonly<Record<string, unknown>>;
  readonly conditionsVersion?: number;
}

export interface CreateScoringRuleDeps {
  readonly scoringRules: RiskScoringRuleRepository;
  readonly auditRecorder: AuditRecorder;
  readonly clock: Clock;
  readonly generateRiskScoringRuleId: () => RiskScoringRuleId;
}

/**
 * Draft create: SUPERVISOR only. Always persists INACTIVE.
 * Structural JDM validation happens at the HTTP boundary before this use case.
 */
export function createCreateScoringRuleUseCase(deps: CreateScoringRuleDeps) {
  return async function createScoringRule(input: CreateScoringRuleInput): Promise<RiskScoringRule> {
    requireOperationalRole(input.auth, SCORING_RULE_WRITE_ROLES);
    const organizationId = requireTenantContext(input.auth);
    const now = deps.clock.now();

    const rule = RiskScoringRuleAggregate.create({
      id: deps.generateRiskScoringRuleId(),
      organizationId,
      name: input.name,
      conditions: input.conditions,
      conditionsVersion: input.conditionsVersion ?? 1,
      now,
    });

    await deps.scoringRules.save(rule);

    await deps.auditRecorder.record({
      organizationId,
      actorType: input.auth.actorType,
      actorId: input.auth.userId,
      action: 'CREATE_SCORING_RULE',
      resource: 'rule',
      resourceId: rule.id,
      detail: {
        name: rule.name,
        conditionsVersion: rule.conditionsVersion,
        status: rule.status,
      },
      ipAddress: input.auth.ipAddress,
    });

    return rule;
  };
}
