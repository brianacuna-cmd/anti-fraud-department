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
    alertType: document.alert_type as AlertType,
    suspectedEntity: document.suspected_entity,
    confidence: createMatchScore(document.confidence),
    detectionSource: document.detection_source,
    status: createAmlAlertStatus(document.status),
    severity: createAmlAlertSeverity(document.severity),
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
    alert_type: alert.alertType,
    suspected_entity: alert.suspectedEntity,
    confidence: alert.confidence,
    detection_source: alert.detectionSource,
    status: alert.status,
    severity: alert.severity,
    matched_entry: matchedEntryToDocument(alert.matchedEntry),
    case_id: alert.caseId ? new ObjectId(alert.caseId) : null,
    created_at: toDate(alert.createdAt),
    updated_at: toDate(alert.updatedAt),
  };
}

function matchedEntryToDomain(entry: AmlAlertMatchedEntryDocument): ReturnType<typeof createScreeningMatch> {
  return createScreeningMatch({
    entryId: createWatchlistEntryId(entry.entry_id.toString()),
    watchlistId: createWatchlistId(entry.watchlist_id.toString()),
    name: entry.name,
    document: entry.document,
    riskLevel: entry.risk_level,
    matchField: createMatchField(entry.match_field),
    algorithm: entry.algorithm,
  });
}

function matchedEntryToDocument(match: ReturnType<typeof createScreeningMatch>): AmlAlertMatchedEntryDocument {
  return {
    entry_id: new ObjectId(match.entryId),
    watchlist_id: new ObjectId(match.watchlistId),
    name: match.name,
    document: match.document,
    risk_level: match.riskLevel,
    match_field: match.matchField,
    algorithm: match.algorithm,
  };
}
