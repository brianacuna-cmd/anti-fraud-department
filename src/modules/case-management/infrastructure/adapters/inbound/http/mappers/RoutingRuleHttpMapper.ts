import { toDate } from '../../../../../../../shared/time/Instant.js';
import type { CaseRoutingRule } from '../../../../../domain/model/aggregates/CaseRoutingRule.js';

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
