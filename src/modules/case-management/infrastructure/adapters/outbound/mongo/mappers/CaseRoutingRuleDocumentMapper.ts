import { ObjectId } from 'mongodb';
import { fromDate, toDate } from '../../../../../../../shared/time/Instant.js';
import { CaseRoutingRule } from '../../../../../domain/model/aggregates/CaseRoutingRule.js';
import { createCaseRoutingRuleId } from '../../../../../domain/model/value-objects/CaseRoutingRuleId.js';
import { createRoutingRuleStatus } from '../../../../../domain/model/value-objects/RoutingRuleStatus.js';
import type { CaseRoutingRuleDocument } from '../documents/CaseRoutingRuleDocument.js';

/** snake_case (Mongo) -> camelCase (domain). Instant fields are BSON `Date`. */
export function toDomain(document: CaseRoutingRuleDocument): CaseRoutingRule {
  return CaseRoutingRule.rehydrate({
    id: createCaseRoutingRuleId(document._id.toString()),
    organizationId: document.organization_id.toString(),
    name: document.name,
    conditions: document.conditions,
    conditionsVersion: document.conditions_version,
    targetRoleId: document.target_role_id,
    targetUserId: document.target_user_id,
    status: createRoutingRuleStatus(document.status),
    executionOrder: document.execution_order ?? 0,
    createdAt: fromDate(document.created_at),
    updatedAt: fromDate(document.updated_at),
  });
}

/** camelCase (domain) -> snake_case (Mongo). */
export function toDocument(rule: CaseRoutingRule): CaseRoutingRuleDocument {
  return {
    _id: new ObjectId(rule.id),
    organization_id: new ObjectId(rule.organizationId),
    name: rule.name,
    conditions: rule.conditions,
    conditions_version: rule.conditionsVersion,
    target_role_id: rule.targetRoleId,
    target_user_id: rule.targetUserId,
    status: rule.status,
    execution_order: rule.executionOrder,
    created_at: toDate(rule.createdAt),
    updated_at: toDate(rule.updatedAt),
  };
}
