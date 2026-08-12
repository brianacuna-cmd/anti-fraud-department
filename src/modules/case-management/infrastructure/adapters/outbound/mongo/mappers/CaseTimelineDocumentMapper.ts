import { brand } from '../../../../../../../shared/kernel/Brand.js';
import { CaseTimelineEvent } from '../../../../../domain/model/aggregates/CaseTimelineEvent.js';
import { createTimelineEventId } from '../../../../../domain/model/value-objects/TimelineEventId.js';
import { createCaseId } from '../../../../../domain/model/value-objects/CaseId.js';
import { createTimelineEventType } from '../../../../../domain/model/value-objects/TimelineEventType.js';
import type { CaseTimelineDocument } from '../documents/CaseTimelineDocument.js';

/**
 * camelCase (domain) -> PascalCase (Mongo) translation seam (mirrors
 * `AuditLogDocumentMapper`). `_id` is the sole documented exception and
 * stays lowercase. Every nullable field is written explicitly, never
 * omitted.
 */
export function toDocument(event: CaseTimelineEvent): CaseTimelineDocument {
  return {
    _id: event.id,
    CaseId: event.caseId,
    EventType: event.eventType,
    PreviousValue: event.previousValue,
    NewValue: event.newValue,
    CreatedBy: event.createdBy,
    CreatedAt: event.createdAt,
  };
}

/** PascalCase (Mongo) -> camelCase (domain) translation seam (mirrors `AuditLogDocumentMapper`). */
export function toDomain(document: CaseTimelineDocument): CaseTimelineEvent {
  return CaseTimelineEvent.rehydrate({
    id: createTimelineEventId(document._id),
    caseId: createCaseId(document.CaseId),
    eventType: createTimelineEventType(document.EventType),
    previousValue: document.PreviousValue,
    newValue: document.NewValue,
    createdBy: document.CreatedBy,
    createdAt: brand<string, 'Instant'>(document.CreatedAt),
  });
}
