import { ObjectId } from 'mongodb';
import { fromDate, toDate } from '../../../../../../../shared/time/Instant.js';
import { Case } from '../../../../../domain/model/aggregates/Case.js';
import { createCaseId } from '../../../../../domain/model/value-objects/CaseId.js';
import { createCaseStatus } from '../../../../../domain/model/value-objects/CaseStatus.js';
import { createCasePriority } from '../../../../../domain/model/value-objects/CasePriority.js';
import { createRiskScore } from '../../../../../domain/model/value-objects/RiskScore.js';
import { createAssignedTo } from '../../../../../domain/model/value-objects/AssignedTo.js';
import type { CaseDocument } from '../documents/CaseDocument.js';

/** camelCase (domain) -> snake_case (Mongo). Instant fields become BSON `Date`. */
export function toDocument(kase: Case): CaseDocument {
  const assignedTo = kase.assignedTo;
  return {
    _id: new ObjectId(kase.id),
    organization_id: new ObjectId(kase.organizationId),
    customer_id: kase.customerId,
    customer_email: kase.customerEmail,
    bridge_user_id: kase.bridgeUserId,
    bridge_wallet: kase.bridgeWallet,
    stripe_customer_id: kase.stripeCustomerId,
    finturu_reference: kase.finturuReference,
    scoring_evidence: kase.scoringEvidence,
    idempotency_key: kase.idempotencyKey,
    risk_score: kase.riskScore,
    status: kase.status,
    priority: kase.priority,
    assigned_to: assignedTo === null ? null : assignedTo.id,
    assigned_to_type: assignedTo === null ? null : assignedTo.type,
    due_date: kase.dueDate === null ? null : toDate(kase.dueDate),
    tags: kase.tags,
    created_at: toDate(kase.createdAt),
    updated_at: toDate(kase.updatedAt),
    deleted_at: kase.deletedAt === null ? null : toDate(kase.deletedAt),
  };
}

/** snake_case (Mongo) -> camelCase (domain). */
export function toDomain(document: CaseDocument): Case {
  return Case.rehydrate({
    id: createCaseId(document._id.toString()),
    organizationId: document.organization_id.toString(),
    customerId: document.customer_id,
    customerEmail: document.customer_email,
    bridgeUserId: document.bridge_user_id,
    bridgeWallet: document.bridge_wallet,
    stripeCustomerId: document.stripe_customer_id,
    finturuReference: document.finturu_reference,
    scoringEvidence: document.scoring_evidence ?? null,
    idempotencyKey: document.idempotency_key,
    riskScore: createRiskScore(document.risk_score),
    status: createCaseStatus(document.status),
    priority: createCasePriority(document.priority),
    assignedTo:
      document.assigned_to === null || document.assigned_to_type === null
        ? null
        : createAssignedTo(document.assigned_to_type, document.assigned_to),
    dueDate: document.due_date === null ? null : fromDate(document.due_date),
    tags: document.tags,
    createdAt: fromDate(document.created_at),
    updatedAt: fromDate(document.updated_at),
    deletedAt: document.deleted_at === null ? null : fromDate(document.deleted_at),
  });
}
