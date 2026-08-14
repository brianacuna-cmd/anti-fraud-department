import { ObjectId } from 'mongodb';
import { fromDate, toDate } from '../../../../../../../shared/time/Instant.js';
import { EnforcementAction } from '../../../../../domain/model/aggregates/EnforcementAction.js';
import { createEnforcementActionId } from '../../../../../domain/model/value-objects/EnforcementActionId.js';
import { createEnforcementActionType } from '../../../../../domain/model/value-objects/EnforcementActionType.js';
import { createEnforcementActionStatus } from '../../../../../domain/model/value-objects/EnforcementActionStatus.js';
import { createAnalystDecisionId } from '../../../../../domain/model/value-objects/AnalystDecisionId.js';
import { createCaseId } from '../../../../../domain/model/value-objects/CaseId.js';
import type { EnforcementActionDocument } from '../documents/EnforcementActionDocument.js';

export function toDocument(action: EnforcementAction): EnforcementActionDocument {
  return {
    _id: new ObjectId(action.id),
    case_id: new ObjectId(action.caseId),
    organization_id: new ObjectId(action.organizationId),
    analyst_decision_id: new ObjectId(action.analystDecisionId),
    action_type: action.actionType,
    target_type: action.targetType,
    target_id: action.targetId,
    status: action.status,
    created_by: new ObjectId(action.createdBy),
    created_at: toDate(action.createdAt),
    updated_at: toDate(action.updatedAt),
  };
}

export function toDomain(document: EnforcementActionDocument): EnforcementAction {
  return EnforcementAction.rehydrate({
    id: createEnforcementActionId(document._id.toString()),
    caseId: createCaseId(document.case_id.toString()),
    organizationId: document.organization_id.toString(),
    analystDecisionId: createAnalystDecisionId(document.analyst_decision_id.toString()),
    actionType: createEnforcementActionType(document.action_type),
    targetType: document.target_type,
    targetId: document.target_id,
    status: createEnforcementActionStatus(document.status),
    createdBy: document.created_by.toString(),
    createdAt: fromDate(document.created_at),
    updatedAt: fromDate(document.updated_at),
  });
}
