import type { AmlAlert } from '../../../../../domain/model/aggregates/AmlAlert.js';
import type { AmlExpedienteTimelineEvent } from '../../../../../domain/ports/AmlExpedienteTimelineRecorder.js';

export interface AmlAlertMatchedEntryDto {
  readonly entryId: string;
  readonly watchlistId: string;
  readonly nombre: string;
  readonly documento: string | null;
  readonly nivelRiesgo: string | null;
  readonly matchField: string;
  readonly algorithm: string;
}

export interface AmlAlertResponseDto {
  readonly id: string;
  readonly organizationId: string;
  readonly customerId: string;
  readonly tipoAlerta: string;
  readonly entidadSospechosa: string;
  readonly confianza: number;
  readonly fuenteDeteccion: string;
  readonly estado: string;
  readonly severidad: string;
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
    tipoAlerta: alert.alertType,
    entidadSospechosa: alert.suspectedEntity,
    confianza: alert.confidence,
    fuenteDeteccion: alert.detectionSource,
    estado: alert.status,
    severidad: alert.severity,
    matchedEntry: {
      entryId: String(alert.matchedEntry.entryId),
      watchlistId: String(alert.matchedEntry.watchlistId),
      nombre: alert.matchedEntry.name,
      documento: alert.matchedEntry.document,
      nivelRiesgo: alert.matchedEntry.riskLevel,
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
