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
    notified_statuses: Array.from(tracking.notifiedStatuses),
    created_at: toDate(tracking.createdAt),
    updated_at: toDate(tracking.updatedAt),
  };
}

/**
 * snake_case (Mongo) -> camelCase (domain). Tolerant read for `notified_statuses`
 * (PR1: per-status re-notify): new-shape docs read the array directly; legacy
 * docs with only `notification_sent === true` seed the CURRENT persisted status
 * as already-notified (best sensible default); otherwise empty set.
 */
export function toDomain(document: CaseSlaTrackingDocument): CaseSlaTracking {
  const status = createSlaStatus(document.status);
  const notifiedStatuses = resolveNotifiedStatuses(document, status);

  return CaseSlaTracking.rehydrate({
    id: createCaseSlaTrackingId(document._id.toString()),
    caseId: createCaseId(document.case_id.toString()),
    dueDate: fromDate(document.due_date),
    status,
    notifiedStatuses,
    createdAt: fromDate(document.created_at),
    updatedAt: fromDate(document.updated_at),
  });
}

function resolveNotifiedStatuses(
  document: CaseSlaTrackingDocument,
  status: ReturnType<typeof createSlaStatus>,
): ReadonlySet<ReturnType<typeof createSlaStatus>> {
  if (document.notified_statuses !== undefined) {
    return new Set(document.notified_statuses.map(createSlaStatus));
  }
  if (document.notification_sent === true) {
    return new Set([status]);
  }
  return new Set();
}
