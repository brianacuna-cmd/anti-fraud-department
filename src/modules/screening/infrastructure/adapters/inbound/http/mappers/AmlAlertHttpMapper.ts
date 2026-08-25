import type { AmlAlert } from '../../../../../domain/model/aggregates/AmlAlert.js';
import type { AmlExpedienteTimelineEvent } from '../../../../../domain/ports/AmlExpedienteTimelineRecorder.js';

export interface AmlAlertMatchedEntryDto {
  readonly entryId: string;
  readonly watchlistId: string;
  readonly name: string;
  readonly document: string | null;
  readonly riskLevel: string | null;
  readonly matchField: string;
  readonly algorithm: string;
}

export interface AmlAlertResponseDto {
  readonly id: string;
  readonly organizationId: string;
  readonly customerId: string;
  readonly alertType: string;
  readonly suspectedEntity: string;
  readonly confidence: number;
  readonly detectionSource: string;
  readonly status: string;
  readonly severity: string;
  readonly matchedEntry: AmlAlertMatchedEntryDto;
  readonly caseId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AmlAlertTimelineEventDto {
  readonly id: string;
  readonly eventType: string;
  readonly previousValue: string | null;
  readonly newValue: string;
  readonly createdBy: string | null;
  readonly createdAt: string;
}

export function toAmlAlertResponse(alert: AmlAlert): AmlAlertResponseDto {
  return {
    id: String(alert.id),
    organizationId: alert.organizationId,
    customerId: alert.customerId,
    alertType: alert.alertType,
    suspectedEntity: alert.suspectedEntity,
    confidence: alert.confidence,
    detectionSource: alert.detectionSource,
    status: alert.status,
    severity: alert.severity,
    matchedEntry: {
      entryId: String(alert.matchedEntry.entryId),
      watchlistId: String(alert.matchedEntry.watchlistId),
      name: alert.matchedEntry.name,
      document: alert.matchedEntry.document,
      riskLevel: alert.matchedEntry.riskLevel,
      matchField: alert.matchedEntry.matchField,
      algorithm: alert.matchedEntry.algorithm,
    },
    caseId: alert.caseId,
    createdAt: alert.createdAt,
    updatedAt: alert.updatedAt,
  };
}

export function toAmlAlertTimelineEventResponse(
  event: AmlExpedienteTimelineEvent,
): AmlAlertTimelineEventDto {
  return {
    id: event.id,
    eventType: event.eventType,
    previousValue: event.previousValue,
    newValue: event.newValue,
    createdBy: event.createdBy,
    createdAt: event.createdAt,
  };
}
