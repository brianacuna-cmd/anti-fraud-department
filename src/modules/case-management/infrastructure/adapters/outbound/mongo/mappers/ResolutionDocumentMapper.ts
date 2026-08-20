import { ObjectId } from 'mongodb';
import { fromDate, toDate } from '../../../../../../../shared/time/Instant.js';
import { Resolution, type ResolutionClosureType } from '../../../../../domain/model/aggregates/Resolution.js';
import { createResolutionId } from '../../../../../domain/model/value-objects/ResolutionId.js';
import { createCaseId } from '../../../../../domain/model/value-objects/CaseId.js';
import type { ResolutionDocument } from '../documents/ResolutionDocument.js';

/** camelCase (domain) -> snake_case (Mongo). Instant fields become BSON `Date`. */
export function toDocument(resolution: Resolution): ResolutionDocument {
  return {
    _id: new ObjectId(resolution.id),
    case_id: new ObjectId(resolution.caseId),
    organization_id: new ObjectId(resolution.organizationId),
    closure_type: resolution.closureType,
    reason: resolution.reason,
    resolved_by: resolution.resolvedBy,
    created_at: toDate(resolution.createdAt),
  };
}

/** snake_case (Mongo) -> camelCase (domain). */
export function toDomain(document: ResolutionDocument): Resolution {
  return Resolution.rehydrate({
    id: createResolutionId(document._id.toString()),
    caseId: createCaseId(document.case_id.toString()),
    organizationId: document.organization_id.toString(),
    closureType: document.closure_type as ResolutionClosureType,
    reason: document.reason,
    resolvedBy: document.resolved_by,
    createdAt: fromDate(document.created_at),
  });
}
