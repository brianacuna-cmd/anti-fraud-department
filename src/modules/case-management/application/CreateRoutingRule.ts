import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { CaseRoutingRule } from '../domain/model/aggregates/CaseRoutingRule.js';
import { CaseRoutingRule as CaseRoutingRuleAggregate } from '../domain/model/aggregates/CaseRoutingRule.js';
import type { CaseRoutingRuleId } from '../domain/model/value-objects/CaseRoutingRuleId.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { CaseRoutingRuleRepository } from '../domain/ports/CaseRoutingRuleRepository.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireRole } from './authorization/requireRole.js';

const ROUTING_RULE_WRITE_ROLES = ['SUPERVISOR', 'ADMIN'] as const;

export interface CreateRoutingRuleInput {
  readonly auth: AuthContext;
  readonly name: string;
  readonly conditions: Readonly<Record<string, unknown>>;
  readonly conditionsVersion?: number;
  readonly targetRoleId?: string | null;
  readonly targetUserId?: string | null;
}

export interface CreateRoutingRuleDeps {
  readonly routingRules: CaseRoutingRuleRepository;
  readonly auditRecorder: AuditRecorder;
  readonly clock: Clock;
  readonly generateCaseRoutingRuleId: () => CaseRoutingRuleId;
}

/**
 * Draft create: SUPERVISOR|ADMIN only. Always persists INACTIVE.
 * Structural JDM validation happens at the HTTP boundary before this use case.
 */
export function createCreateRoutingRuleUseCase(deps: CreateRoutingRuleDeps) {
  return async function createRoutingRule(input: CreateRoutingRuleInput): Promise<CaseRoutingRule> {
    requireRole(input.auth, ROUTING_RULE_WRITE_ROLES);
    const organizationId = requireTenantContext(input.auth);
    const now = deps.clock.now();

    const rule = CaseRoutingRuleAggregate.create({
      id: deps.generateCaseRoutingRuleId(),
      organizationId,
      name: input.name,
      conditions: input.conditions,
      conditionsVersion: input.conditionsVersion ?? 1,
      targetRoleId: input.targetRoleId ?? null,
      targetUserId: input.targetUserId ?? null,
      now,
    });

    await deps.routingRules.save(rule);

    await deps.auditRecorder.record({
      organizationId,
      actorType: input.auth.actorType,
      actorId: input.auth.userId,
      action: 'CREATE_ROUTING_RULE',
      resource: 'rule',
      resourceId: rule.id,
      detail: {
        name: rule.name,
        conditionsVersion: rule.conditionsVersion,
        status: rule.status,
        targetRoleId: rule.targetRoleId,
        targetUserId: rule.targetUserId,
      },
      ipAddress: input.auth.ipAddress,
    });

    return rule;
  };
}
