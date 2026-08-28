import { toDate } from '../../../../../../../shared/time/Instant.js';
import type { CaseRoutingRule } from '../../../../../domain/model/aggregates/CaseRoutingRule.js';
import type { UpdateRoutingRuleBody } from '../dto/routingRuleSchemas.js';

export interface RoutingRuleResponseDto {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly conditions: Readonly<Record<string, unknown>>;
  readonly conditionsVersion: number;
  readonly targetRoleId: string | null;
  readonly targetUserId: string | null;
  readonly status: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** PATCH body → use-case fields. Omits status/executionOrder (schema-rejected). */
export function toUpdateRoutingRuleFields(body: UpdateRoutingRuleBody): {
  readonly name?: string;
  readonly conditions?: Readonly<Record<string, unknown>>;
  readonly targetRoleId?: string | null;
  readonly targetUserId?: string | null;
} {
  return {
    name: body.name,
    conditions: body.conditions,
    targetRoleId: body.targetRoleId,
    targetUserId: body.targetUserId,
  };
}

/** Domain → HTTP DTO for a routing rule. */
export function toRoutingRuleResponse(rule: CaseRoutingRule): RoutingRuleResponseDto {
  return {
    id: rule.id,
    organizationId: rule.organizationId,
    name: rule.name,
    conditions: rule.conditions,
    conditionsVersion: rule.conditionsVersion,
    targetRoleId: rule.targetRoleId,
    targetUserId: rule.targetUserId,
    status: rule.status,
    createdAt: toDate(rule.createdAt).toISOString(),
    updatedAt: toDate(rule.updatedAt).toISOString(),
  };
}
