import { brand } from '../../../../../../../shared/kernel/Brand.js';
import { toDate } from '../../../../../../../shared/time/Instant.js';
import { CaseSlaTracking } from '../../../../../domain/model/aggregates/CaseSlaTracking.js';
import { createCaseSlaTrackingId } from '../../../../../domain/model/value-objects/CaseSlaTrackingId.js';
import { createCaseId } from '../../../../../domain/model/value-objects/CaseId.js';
import { createSlaStatus } from '../../../../../domain/model/value-objects/SlaStatus.js';
import type { CaseSlaTrackingDocument } from '../documents/CaseSlaTrackingDocument.js';

/**
 * camelCase (domain) -> PascalCase (Mongo) translation seam (mirrors
 * `CaseDocumentMapper`). `_id` is the sole documented exception and stays
 * lowercase. `DueDateAt` is derived from `DueDate` on every write — the
 * BSON `Date` mirror (design ADR-6), same pattern as
 * `SessionDocumentMapper`'s `FamilyExpiresAtDate`.
 */
export function toDocument(tracking: CaseSlaTracking): CaseSlaTrackingDocument {
  return {
    _id: tracking.id,
    CaseId: tracking.caseId,
    DueDate: tracking.dueDate,
    DueDateAt: toDate(tracking.dueDate),
    Status: tracking.status,
    NotificationSent: tracking.notificationSent,
    CreatedAt: tracking.createdAt,
    UpdatedAt: tracking.updatedAt,
  };
}

/** PascalCase (Mongo) -> camelCase (domain) translation seam (mirrors `CaseDocumentMapper`). */
export function toDomain(document: CaseSlaTrackingDocument): CaseSlaTracking {
  return CaseSlaTracking.rehydrate({
    id: createCaseSlaTrackingId(document._id),
    caseId: createCaseId(document.CaseId),
    dueDate: brand<string, 'Instant'>(document.DueDate),
    status: createSlaStatus(document.Status),
    notificationSent: document.NotificationSent,
    createdAt: brand<string, 'Instant'>(document.CreatedAt),
    updatedAt: brand<string, 'Instant'>(document.UpdatedAt),
  });
}
