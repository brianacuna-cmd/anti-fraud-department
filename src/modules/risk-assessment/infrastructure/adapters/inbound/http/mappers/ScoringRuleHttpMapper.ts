import { toDate } from '../../../../../../../shared/time/Instant.js';
import type { RiskScoringRule } from '../../../../../domain/model/aggregates/RiskScoringRule.js';

export interface ScoringRuleResponseDto {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly conditions: Readonly<Record<string, unknown>>;
  readonly conditionsVersion: number;
  readonly status: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Domain → HTTP DTO for a scoring rule. */
export function toScoringRuleResponse(rule: RiskScoringRule): ScoringRuleResponseDto {
  return {
    id: rule.id,
    organizationId: rule.organizationId,
    name: rule.name,
    conditions: rule.conditions,
    conditionsVersion: rule.conditionsVersion,
    status: rule.status,
    createdAt: toDate(rule.createdAt).toISOString(),
    updatedAt: toDate(rule.updatedAt).toISOString(),
  };
}
