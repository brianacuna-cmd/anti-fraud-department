import { ObjectId } from 'mongodb';
import { fromDate, toDate } from '../../../../../../../shared/time/Instant.js';
import type {
  AmlExpedienteTimelineEvent,
  AmlExpedienteTimelineEventType,
} from '../../../../../domain/ports/AmlExpedienteTimelineRecorder.js';
import type { AmlExpedienteTimelineDocument } from '../documents/AmlExpedienteTimelineDocument.js';

export function toDocument(event: AmlExpedienteTimelineEvent): AmlExpedienteTimelineDocument {
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

export function toDomain(document: AmlExpedienteTimelineDocument): AmlExpedienteTimelineEvent {
  return {
    id: document._id.toString(),
    caseId: document.case_id.toString(),
    eventType: document.event_type as AmlExpedienteTimelineEventType,
    previousValue: document.previous_value,
    newValue: document.new_value ?? '',
    createdBy: document.created_by,
    createdAt: fromDate(document.created_at),
  };
}
