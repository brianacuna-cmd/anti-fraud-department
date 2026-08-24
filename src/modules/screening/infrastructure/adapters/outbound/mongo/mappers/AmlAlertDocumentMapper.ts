import { ObjectId } from 'mongodb';
import { fromDate, toDate } from '../../../../../../../shared/time/Instant.js';
import { AmlAlert, type AlertType } from '../../../../../domain/model/aggregates/AmlAlert.js';
import { createAmlAlertId } from '../../../../../domain/model/value-objects/AmlAlertId.js';
import { createAmlAlertStatus } from '../../../../../domain/model/value-objects/AmlAlertStatus.js';
import { createAmlAlertSeverity } from '../../../../../domain/model/value-objects/AmlAlertSeverity.js';
import { createMatchScore } from '../../../../../domain/model/value-objects/MatchScore.js';
import { createMatchField } from '../../../../../domain/model/value-objects/MatchField.js';
import { createWatchlistEntryId } from '../../../../../domain/model/value-objects/WatchlistEntryId.js';
import { createWatchlistId } from '../../../../../domain/model/value-objects/WatchlistId.js';
import { createScreeningMatch } from '../../../../../domain/model/entities/ScreeningMatch.js';
import type { AmlAlertDocument, AmlAlertMatchedEntryDocument } from '../documents/AmlAlertDocument.js';

/** snake_case (Mongo) -> camelCase (domain). Instant fields are BSON `Date`. */
export function toDomain(document: AmlAlertDocument): AmlAlert {
  return AmlAlert.rehydrate({
    id: createAmlAlertId(document._id.toString()),
    organizationId: document.organization_id.toString(),
    customerId: document.customer_id,
    alertType: document.tipo_alerta as AlertType,
    suspectedEntity: document.entidad_sospechosa,
    confidence: createMatchScore(document.confianza),
    detectionSource: document.fuente_deteccion,
    status: createAmlAlertStatus(document.estado),
    severity: createAmlAlertSeverity(document.severidad),
    matchedEntry: matchedEntryToDomain(document.matched_entry),
    caseId: document.case_id ? document.case_id.toString() : null,
    createdAt: fromDate(document.created_at),
    updatedAt: fromDate(document.updated_at),
  });
}

/** camelCase (domain) -> snake_case (Mongo). */
export function toDocument(alert: AmlAlert): AmlAlertDocument {
  return {
    _id: new ObjectId(alert.id),
    organization_id: new ObjectId(alert.organizationId),
    customer_id: alert.customerId,
    tipo_alerta: alert.alertType,
    entidad_sospechosa: alert.suspectedEntity,
    confianza: alert.confidence,
    fuente_deteccion: alert.detectionSource,
    estado: alert.status,
    severidad: alert.severity,
    matched_entry: matchedEntryToDocument(alert.matchedEntry),
    case_id: alert.caseId ? new ObjectId(alert.caseId) : null,
    created_at: toDate(alert.createdAt),
    updated_at: toDate(alert.updatedAt),
  };
}

function matchedEntryToDomain(document: AmlAlertMatchedEntryDocument): ReturnType<typeof createScreeningMatch> {
  return createScreeningMatch({
    entryId: createWatchlistEntryId(document.entry_id.toString()),
    watchlistId: createWatchlistId(document.watchlist_id.toString()),
    name: document.nombre,
    document: document.documento,
    riskLevel: document.nivel_riesgo,
    matchField: createMatchField(document.match_field),
    algorithm: document.algorithm,
  });
}

function matchedEntryToDocument(match: ReturnType<typeof createScreeningMatch>): AmlAlertMatchedEntryDocument {
  return {
    entry_id: new ObjectId(match.entryId),
    watchlist_id: new ObjectId(match.watchlistId),
    nombre: match.name,
    documento: match.document,
    nivel_riesgo: match.riskLevel,
    match_field: match.matchField,
    algorithm: match.algorithm,
  };
}
