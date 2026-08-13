import { ObjectId } from 'mongodb';
import { fromDate, toDate } from '../../../../../../../shared/time/Instant.js';
import { CaseSlaTracking } from '../../../../../domain/model/aggregates/CaseSlaTracking.js';
import { createCaseSlaTrackingId } from '../../../../../domain/model/value-objects/CaseSlaTrackingId.js';
import { createCaseId } from '../../../../../domain/model/value-objects/CaseId.js';
import { createSlaStatus } from '../../../../../domain/model/value-objects/SlaStatus.js';
import type { CaseSlaTrackingDocument } from '../documents/CaseSlaTrackingDocument.js';

/** camelCase (domain) -> snake_case (Mongo). Instant fields become BSON `Date`. */
export function toDocument(tracking: CaseSlaTracking): CaseSlaTrackingDocument {
  return {
    _id: new ObjectId(tracking.id),
    case_id: new ObjectId(tracking.caseId),
    due_date: toDate(tracking.dueDate),
    status: tracking.status,
    notification_sent: tracking.notificationSent,
    created_at: toDate(tracking.createdAt),
    updated_at: toDate(tracking.updatedAt),
  };
}

/** snake_case (Mongo) -> camelCase (domain). */
export function toDomain(document: CaseSlaTrackingDocument): CaseSlaTracking {
  return CaseSlaTracking.rehydrate({
    id: createCaseSlaTrackingId(document._id.toString()),
    caseId: createCaseId(document.case_id.toString()),
    dueDate: fromDate(document.due_date),
    status: createSlaStatus(document.status),
    notificationSent: document.notification_sent,
    createdAt: fromDate(document.created_at),
    updatedAt: fromDate(document.updated_at),
  });
}
