import type { DeadLetterEvent } from '../../../../../../../shared/outbox/DeadLetterEvent.js';

/**
 * List projection: omits `payload` and maps `reason` → `error_trace` is
 * intentionally NOT included in the list view — the stored `reason` is a
 * potentially large error string; the list is metadata-only (D5). The
 * inspect endpoint includes both `error_trace` and `payload`.
 */
export interface DlqListItemDto {
  readonly id: string;
  readonly organizationId: string;
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly publishAttempts: number;
  readonly createdAt: string;
  readonly exhaustedAt: string;
}

/**
 * Inspect projection: includes the full `payload` and the stored `reason`
 * field renamed to `error_trace` (D5 — HTTP-only rename, no schema change).
 */
export interface DlqInspectDto {
  readonly id: string;
  readonly organizationId: string;
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly publishAttempts: number;
  readonly error_trace: string;
  readonly payload: Record<string, unknown>;
  readonly createdAt: string;
  readonly exhaustedAt: string;
}

/** Maps a `DeadLetterEvent` to the list-safe DTO (no payload, no error_trace). */
export function toDlqListItem(event: DeadLetterEvent): DlqListItemDto {
  return {
    id: event.id,
    organizationId: event.organizationId,
    eventType: event.eventType,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    publishAttempts: event.publishAttempts,
    createdAt: event.createdAt,
    exhaustedAt: event.exhaustedAt,
  };
}

/** Maps a `DeadLetterEvent` to the full inspect DTO including payload and error_trace. */
export function toDlqInspectDto(event: DeadLetterEvent): DlqInspectDto {
  return {
    id: event.id,
    organizationId: event.organizationId,
    eventType: event.eventType,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    publishAttempts: event.publishAttempts,
    error_trace: event.reason,
    payload: event.payload,
    createdAt: event.createdAt,
    exhaustedAt: event.exhaustedAt,
  };
}
