import { ObjectId } from 'mongodb';
import { brand } from '../../../../../../../shared/kernel/Brand.js';
import { CaseRoutingRule, type RoutingConditions } from '../../../../../domain/model/aggregates/CaseRoutingRule.js';
import { createCaseRoutingRuleId } from '../../../../../domain/model/value-objects/CaseRoutingRuleId.js';
import { createCasePriority } from '../../../../../domain/model/value-objects/CasePriority.js';
import { createAssignedTo } from '../../../../../domain/model/value-objects/AssignedTo.js';
import type {
  CaseRoutingRuleConditionsDocument,
  CaseRoutingRuleDocument,
} from '../documents/CaseRoutingRuleDocument.js';

/**
 * `undefined` significa "sin restringir" y NO puede confundirse con un valor.
 * Mongo guarda las claves ausentes como inexistentes, asi que se omiten en vez
 * de escribirlas a null: un `RiskScoreMin: null` se leeria como el numero 0 en
 * cuanto alguien lo comparase sin cuidado, y esa regla capturaria todo.
 */
function conditionsToDocument(conditions: RoutingConditions): CaseRoutingRuleConditionsDocument {
  const doc: Record<string, unknown> = {};
  if (conditions.riskScoreMin !== undefined) doc.RiskScoreMin = conditions.riskScoreMin;
  if (conditions.riskScoreMax !== undefined) doc.RiskScoreMax = conditions.riskScoreMax;
  if (conditions.priorities !== undefined) doc.Priorities = [...conditions.priorities];
  if (conditions.tags !== undefined) doc.Tags = [...conditions.tags];
  if (conditions.customerEmailDomain !== undefined) doc.CustomerEmailDomain = conditions.customerEmailDomain;
  if (conditions.hasStripeCustomer !== undefined) doc.HasStripeCustomer = conditions.hasStripeCustomer;
  if (conditions.hasBridgeWallet !== undefined) doc.HasBridgeWallet = conditions.hasBridgeWallet;
  return doc as CaseRoutingRuleConditionsDocument;
}

function conditionsToDomain(doc: CaseRoutingRuleConditionsDocument | undefined): RoutingConditions {
  if (!doc) return {};
  const conditions: Record<string, unknown> = {};
  if (doc.RiskScoreMin !== undefined) conditions.riskScoreMin = doc.RiskScoreMin;
  if (doc.RiskScoreMax !== undefined) conditions.riskScoreMax = doc.RiskScoreMax;
  if (doc.Priorities !== undefined) conditions.priorities = doc.Priorities.map(createCasePriority);
  if (doc.Tags !== undefined) conditions.tags = [...doc.Tags];
  if (doc.CustomerEmailDomain !== undefined) conditions.customerEmailDomain = doc.CustomerEmailDomain;
  if (doc.HasStripeCustomer !== undefined) conditions.hasStripeCustomer = doc.HasStripeCustomer;
  if (doc.HasBridgeWallet !== undefined) conditions.hasBridgeWallet = doc.HasBridgeWallet;
  return conditions as RoutingConditions;
}

/** camelCase (domain) -> PascalCase (Mongo), mirroring `CaseDocumentMapper`. */
export function toDocument(rule: CaseRoutingRule): CaseRoutingRuleDocument {
  return {
    _id: new ObjectId(rule.id),
    OrganizationId: rule.organizationId,
    Name: rule.name,
    EvaluationOrder: rule.evaluationOrder,
    Conditions: conditionsToDocument(rule.conditions),
    AssignTo: rule.assignTo.id,
    AssignToType: rule.assignTo.type,
    Status: rule.status,
    CreatedAt: rule.createdAt,
    UpdatedAt: rule.updatedAt,
  };
}

/** PascalCase (Mongo) -> camelCase (domain). */
export function toDomain(document: CaseRoutingRuleDocument): CaseRoutingRule {
  return CaseRoutingRule.rehydrate({
    id: createCaseRoutingRuleId(document._id.toString()),
    organizationId: document.OrganizationId,
    name: document.Name,
    evaluationOrder: document.EvaluationOrder,
    conditions: conditionsToDomain(document.Conditions),
    assignTo: createAssignedTo(document.AssignToType, document.AssignTo),
    status: document.Status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
    createdAt: brand<string, 'Instant'>(document.CreatedAt),
    updatedAt: brand<string, 'Instant'>(document.UpdatedAt),
  });
}
