import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { CaseRoutingRule } from '../domain/model/aggregates/CaseRoutingRule.js';
import { CaseRoutingRule as CaseRoutingRuleAggregate } from '../domain/model/aggregates/CaseRoutingRule.js';
import type { CaseRoutingRuleId } from '../domain/model/value-objects/CaseRoutingRuleId.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { CaseRoutingRuleRepository } from '../domain/ports/CaseRoutingRuleRepository.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireOperationalRole, SUPERVISION_ROLES } from './authorization/policy.js';

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
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly generateCaseRoutingRuleId: () => CaseRoutingRuleId;
}

/**
 * Draft create: SUPERVISOR only. Always persists INACTIVE. Structural
 * JDM validation happens at the HTTP boundary before this use case.
 * Appends at max(executionOrder)+1 (0 when the catalog is empty).
 * REQ-E1: save + audit run inside one UnitOfWork (mirrors
 * ApproveEnforcementAction.ts) so the rule is never persisted without its
 * audit trail.
 */
export function createCreateRoutingRuleUseCase(deps: CreateRoutingRuleDeps) {
  return async function createRoutingRule(input: CreateRoutingRuleInput): Promise<CaseRoutingRule> {
    requireOperationalRole(input.auth, SUPERVISION_ROLES);
    const organizationId = requireTenantContext(input.auth);
    const now = deps.clock.now();

    return deps.unitOfWork.withTransaction(async (tx) => {
      const existing = await deps.routingRules.listByOrganization(organizationId, tx);
      const rule = CaseRoutingRuleAggregate.create({
        id: deps.generateCaseRoutingRuleId(),
        organizationId,
        name: input.name,
        conditions: input.conditions,
        conditionsVersion: input.conditionsVersion ?? 1,
        targetRoleId: input.targetRoleId ?? null,
        targetUserId: input.targetUserId ?? null,
        executionOrder: nextExecutionOrder(existing),
        now,
      });

      await deps.routingRules.save(rule, tx);

      await deps.auditRecorder.record(
        {
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
        },
        tx,
      );

      return rule;
    });
  };
}

function nextExecutionOrder(rules: readonly CaseRoutingRule[]): number {
  if (rules.length === 0) {
    return 0;
  }
  return Math.max(...rules.map((rule) => rule.executionOrder)) + 1;
}
