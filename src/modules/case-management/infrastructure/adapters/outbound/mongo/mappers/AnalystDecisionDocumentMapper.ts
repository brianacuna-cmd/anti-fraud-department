import { ObjectId } from 'mongodb';
import { fromDate, toDate } from '../../../../../../../shared/time/Instant.js';
import { AnalystDecision } from '../../../../../domain/model/aggregates/AnalystDecision.js';
import { createAnalystDecisionId } from '../../../../../domain/model/value-objects/AnalystDecisionId.js';
import { createAnalystDecisionType } from '../../../../../domain/model/value-objects/AnalystDecisionType.js';
import { createCaseId } from '../../../../../domain/model/value-objects/CaseId.js';
import type { AnalystDecisionDocument } from '../documents/AnalystDecisionDocument.js';

export function toDocument(decision: AnalystDecision): AnalystDecisionDocument {
  return {
    _id: new ObjectId(decision.id),
    case_id: new ObjectId(decision.caseId),
    organization_id: new ObjectId(decision.organizationId),
    decision: decision.decision,
    confidence: decision.confidence,
    comment: decision.comment,
    created_by: new ObjectId(decision.createdBy),
    created_at: toDate(decision.createdAt),
  };
}

export function toDomain(document: AnalystDecisionDocument): AnalystDecision {
  return AnalystDecision.rehydrate({
    id: createAnalystDecisionId(document._id.toString()),
    caseId: createCaseId(document.case_id.toString()),
    organizationId: document.organization_id.toString(),
    decision: createAnalystDecisionType(document.decision),
    confidence: document.confidence,
    comment: document.comment,
    createdBy: document.created_by.toString(),
    createdAt: fromDate(document.created_at),
  });
}
