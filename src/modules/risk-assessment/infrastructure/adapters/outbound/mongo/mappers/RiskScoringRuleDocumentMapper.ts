import { ObjectId } from 'mongodb';
import { fromDate, toDate } from '../../../../../../../shared/time/Instant.js';
import { RiskScoringRule } from '../../../../../domain/model/aggregates/RiskScoringRule.js';
import { createRiskScoringRuleId } from '../../../../../domain/model/value-objects/RiskScoringRuleId.js';
import { createScoringRuleStatus } from '../../../../../domain/model/value-objects/ScoringRuleStatus.js';
import type { RiskScoringRuleDocument } from '../documents/RiskScoringRuleDocument.js';

/** snake_case (Mongo) -> camelCase (domain). Instant fields are BSON `Date`. */
export function toDomain(document: RiskScoringRuleDocument): RiskScoringRule {
  return RiskScoringRule.rehydrate({
    id: createRiskScoringRuleId(document._id.toString()),
    organizationId: document.organization_id.toString(),
    name: document.name,
    conditions: document.conditions,
    conditionsVersion: document.conditions_version,
    status: createScoringRuleStatus(document.status),
    createdAt: fromDate(document.created_at),
    updatedAt: fromDate(document.updated_at),
  });
}

/** camelCase (domain) -> snake_case (Mongo). JDM `conditions` stay camelCase. */
export function toDocument(rule: RiskScoringRule): RiskScoringRuleDocument {
  return {
    _id: new ObjectId(rule.id),
    organization_id: new ObjectId(rule.organizationId),
    name: rule.name,
    conditions: rule.conditions,
    conditions_version: rule.conditionsVersion,
    status: rule.status,
    created_at: toDate(rule.createdAt),
    updated_at: toDate(rule.updatedAt),
  };
}
