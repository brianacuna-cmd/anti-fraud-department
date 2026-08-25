import { ObjectId } from 'mongodb';
import { fromDate, toDate } from '../../../../../../../shared/time/Instant.js';
import { Evidence, type EvidenceTimestamp } from '../../../../../domain/model/aggregates/Evidence.js';
import { createEvidenceId } from '../../../../../domain/model/value-objects/EvidenceId.js';
import { createCaseId } from '../../../../../domain/model/value-objects/CaseId.js';
import { createInvestigationId } from '../../../../../domain/model/value-objects/InvestigationId.js';
import type { EvidenceDocument } from '../documents/EvidenceDocument.js';
import type { ScanStatus } from '../../../../../domain/ports/MalwareScanner.js';

/** camelCase (domain) -> snake_case (Mongo). Instant fields become BSON `Date`. */
export function toDocument(evidence: Evidence): EvidenceDocument {
  const timestamp = evidence.timestamp;
  return {
    _id: new ObjectId(evidence.id),
    case_id: new ObjectId(evidence.caseId),
    investigation_id: evidence.investigationId === null ? null : new ObjectId(evidence.investigationId),
    organization_id: new ObjectId(evidence.organizationId),
    filename: evidence.filename,
    content_type: evidence.contentType,
    byte_size: evidence.byteSize,
    sha256: evidence.sha256,
    storage_key: evidence.storageKey,
    timestamp:
      timestamp === null
        ? null
        : { token: timestamp.token, authority: timestamp.authority, timestamped_at: toDate(timestamp.timestampedAt) },
    scan_status: evidence.scanStatus,
    uploaded_by: evidence.uploadedBy,
    created_at: toDate(evidence.createdAt),
    deleted_at: evidence.deletedAt === null ? null : toDate(evidence.deletedAt),
  };
}

/** snake_case (Mongo) -> camelCase (domain). */
export function toDomain(document: EvidenceDocument): Evidence {
  const timestamp: EvidenceTimestamp | null =
    document.timestamp === null
      ? null
      : {
          token: document.timestamp.token,
          authority: document.timestamp.authority,
          timestampedAt: fromDate(document.timestamp.timestamped_at),
        };
  return Evidence.rehydrate({
    id: createEvidenceId(document._id.toString()),
    caseId: createCaseId(document.case_id.toString()),
    investigationId: document.investigation_id === null ? null : createInvestigationId(document.investigation_id.toString()),
    organizationId: document.organization_id.toString(),
    filename: document.filename,
    contentType: document.content_type,
    byteSize: document.byte_size,
    sha256: document.sha256,
    storageKey: document.storage_key,
    timestamp,
    // Documento anterior a INV-015: nadie lo escaneo, y asi se dice.
    scanStatus: toScanStatus(document.scan_status),
    uploadedBy: document.uploaded_by,
    createdAt: fromDate(document.created_at),
    deletedAt: document.deleted_at == null ? null : fromDate(document.deleted_at),
  });
}

const SCAN_STATUSES: ReadonlySet<string> = new Set<ScanStatus>(['CLEAN', 'INFECTED', 'SKIPPED']);

function toScanStatus(value: string | null): ScanStatus {
  return value !== null && SCAN_STATUSES.has(value) ? (value as ScanStatus) : 'SKIPPED';
}
