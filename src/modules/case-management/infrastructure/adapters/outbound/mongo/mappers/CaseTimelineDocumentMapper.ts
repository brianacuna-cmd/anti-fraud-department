import { ObjectId } from 'mongodb';
import { fromDate, toDate } from '../../../../../../../shared/time/Instant.js';
import { CaseTimelineEvent } from '../../../../../domain/model/aggregates/CaseTimelineEvent.js';
import { createTimelineEventId } from '../../../../../domain/model/value-objects/TimelineEventId.js';
import { createCaseId } from '../../../../../domain/model/value-objects/CaseId.js';
import { createTimelineEventType } from '../../../../../domain/model/value-objects/TimelineEventType.js';
import type { CaseTimelineDocument } from '../documents/CaseTimelineDocument.js';

/** camelCase (domain) -> snake_case (Mongo). Instant fields become BSON `Date`. */
export function toDocument(event: CaseTimelineEvent): CaseTimelineDocument {
  return {
    _id: new ObjectId(event.id),
    case_id: new ObjectId(event.caseId),
    event_type: event.eventType,
    previous_value: event.previousValue,
    new_value: event.newValue,
    created_by: event.createdBy,
    created_at: toDate(event.createdAt),
  };
}

/** snake_case (Mongo) -> camelCase (domain). */
export function toDomain(document: CaseTimelineDocument): CaseTimelineEvent {
  return CaseTimelineEvent.rehydrate({
    id: createTimelineEventId(document._id.toString()),
    caseId: createCaseId(document.case_id.toString()),
    eventType: createTimelineEventType(document.event_type),
    previousValue: document.previous_value,
    newValue: document.new_value,
    createdBy: document.created_by,
    createdAt: fromDate(document.created_at),
  });
}
