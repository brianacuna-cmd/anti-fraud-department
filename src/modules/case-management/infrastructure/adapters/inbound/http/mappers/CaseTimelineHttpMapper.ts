import type { CaseTimelineEvent } from '../../../../../domain/model/aggregates/CaseTimelineEvent.js';

export interface CaseTimelineEventDto {
  readonly id: string;
  readonly eventType: string;
  readonly previousValue: string | null;
  readonly newValue: string | null;
  readonly createdBy: string | null;
  readonly createdAt: string;
}

export function toTimelineEventResponse(event: CaseTimelineEvent): CaseTimelineEventDto {
  return {
    id: event.id,
    eventType: event.eventType,
    previousValue: event.previousValue,
    newValue: event.newValue,
    createdBy: event.createdBy,
    createdAt: event.createdAt,
  };
}
