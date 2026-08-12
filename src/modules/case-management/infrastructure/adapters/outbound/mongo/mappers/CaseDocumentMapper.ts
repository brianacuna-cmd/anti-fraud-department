import { brand } from '../../../../../../../shared/kernel/Brand.js';
import { Case } from '../../../../../domain/model/aggregates/Case.js';
import { createCaseId } from '../../../../../domain/model/value-objects/CaseId.js';
import { createCaseStatus } from '../../../../../domain/model/value-objects/CaseStatus.js';
import { createCasePriority } from '../../../../../domain/model/value-objects/CasePriority.js';
import { createRiskScore } from '../../../../../domain/model/value-objects/RiskScore.js';
import { createAssignedTo } from '../../../../../domain/model/value-objects/AssignedTo.js';
import type { CaseDocument } from '../documents/CaseDocument.js';

/**
 * camelCase (domain) -> PascalCase (Mongo) translation seam (mirrors
 * `OrganizationDocumentMapper`). `_id` is the sole documented exception and
 * stays lowercase.
 */
export function toDocument(kase: Case): CaseDocument {
  const assignedTo = kase.assignedTo;
  return {
    _id: kase.id,
    OrganizationId: kase.organizationId,
    CustomerId: kase.customerId,
    CustomerEmail: kase.customerEmail,
    BridgeUserId: kase.bridgeUserId,
    BridgeWallet: kase.bridgeWallet,
    StripeCustomerId: kase.stripeCustomerId,
    FinturuReference: kase.finturuReference,
    FinturuCacheSnapshot: kase.finturuCacheSnapshot,
    RiskScore: kase.riskScore,
    Status: kase.status,
    Priority: kase.priority,
    AssignedTo: assignedTo === null ? null : assignedTo.id,
    AssignedToType: assignedTo === null ? null : assignedTo.type,
    DueDate: kase.dueDate,
    Tags: kase.tags,
    CreatedAt: kase.createdAt,
    UpdatedAt: kase.updatedAt,
    DeletedAt: kase.deletedAt,
  };
}

/** PascalCase (Mongo) -> camelCase (domain) translation seam (mirrors `OrganizationDocumentMapper`). */
export function toDomain(document: CaseDocument): Case {
  return Case.rehydrate({
    id: createCaseId(document._id),
    organizationId: document.OrganizationId,
    customerId: document.CustomerId,
    customerEmail: document.CustomerEmail,
    bridgeUserId: document.BridgeUserId,
    bridgeWallet: document.BridgeWallet,
    stripeCustomerId: document.StripeCustomerId,
    finturuReference: document.FinturuReference,
    finturuCacheSnapshot: document.FinturuCacheSnapshot,
    riskScore: createRiskScore(document.RiskScore),
    status: createCaseStatus(document.Status),
    priority: createCasePriority(document.Priority),
    assignedTo:
      document.AssignedTo === null || document.AssignedToType === null
        ? null
        : createAssignedTo(document.AssignedToType, document.AssignedTo),
    dueDate: document.DueDate === null ? null : brand<string, 'Instant'>(document.DueDate),
    tags: document.Tags,
    createdAt: brand<string, 'Instant'>(document.CreatedAt),
    updatedAt: brand<string, 'Instant'>(document.UpdatedAt),
    deletedAt: document.DeletedAt === null ? null : brand<string, 'Instant'>(document.DeletedAt),
  });
}
