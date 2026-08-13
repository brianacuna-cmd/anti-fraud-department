import { ObjectId } from 'mongodb';
import { brand } from '../../../../../../../shared/kernel/Brand.js';
import { CaseRoutingRule } from '../../../../../domain/model/aggregates/CaseRoutingRule.js';
import { createCaseRoutingRuleId } from '../../../../../domain/model/value-objects/CaseRoutingRuleId.js';
import { createRoutingRuleStatus } from '../../../../../domain/model/value-objects/RoutingRuleStatus.js';
import type { CaseRoutingRuleDocument } from '../documents/CaseRoutingRuleDocument.js';

/** PascalCase (Mongo) -> camelCase (domain) translation seam. */
export function toDomain(document: CaseRoutingRuleDocument): CaseRoutingRule {
  return CaseRoutingRule.rehydrate({
    id: createCaseRoutingRuleId(document._id.toString()),
    organizationId: document.OrganizationId,
    name: document.Name,
    conditions: document.Conditions,
    conditionsVersion: document.ConditionsVersion,
    targetRoleId: document.TargetRoleId,
    targetUserId: document.TargetUserId,
    status: createRoutingRuleStatus(document.Status),
    createdAt: brand<string, 'Instant'>(document.CreatedAt),
    updatedAt: brand<string, 'Instant'>(document.UpdatedAt),
  });
}

/** camelCase (domain) -> PascalCase (Mongo) translation seam. */
export function toDocument(rule: CaseRoutingRule): CaseRoutingRuleDocument {
  return {
    _id: new ObjectId(rule.id),
    OrganizationId: rule.organizationId,
    Name: rule.name,
    Conditions: rule.conditions,
    ConditionsVersion: rule.conditionsVersion,
    TargetRoleId: rule.targetRoleId,
    TargetUserId: rule.targetUserId,
    Status: rule.status,
    CreatedAt: rule.createdAt,
    UpdatedAt: rule.updatedAt,
  };
}
