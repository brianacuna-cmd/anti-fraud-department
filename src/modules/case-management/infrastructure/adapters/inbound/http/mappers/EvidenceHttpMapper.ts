import type { Evidence } from '../../../../../domain/model/aggregates/Evidence.js';
import type { ScanStatus } from '../../../../../domain/ports/MalwareScanner.js';

export interface EvidenceDto {
  readonly id: string;
  readonly caseId: string;
  readonly investigationId: string | null;
  readonly filename: string;
  readonly contentType: string;
  readonly byteSize: number;
  readonly sha256: string;
  readonly timestamp: { readonly token: string; readonly authority: string; readonly timestampedAt: string } | null;
  /**
   * Antivirus verdict (INV-015). Exposed because the panel has to be able to
   * tell "it was scanned and it was clean" from "nobody looked": if the front
   * cannot see it, SKIPPED does not exist for whoever instructs the case and
   * the honesty of the datum stays inside the database.
   */
  readonly scanStatus: ScanStatus;
  readonly uploadedBy: string;
  readonly createdAt: string;
}

/** Metadata response — never exposes the internal `storageKey`. */
export function toEvidenceResponse(evidence: Evidence): EvidenceDto {
  const timestamp = evidence.timestamp;
  return {
    id: evidence.id,
    caseId: evidence.caseId,
    investigationId: evidence.investigationId,
    filename: evidence.filename,
    contentType: evidence.contentType,
    byteSize: evidence.byteSize,
    sha256: evidence.sha256,
    timestamp:
      timestamp === null
        ? null
        : { token: timestamp.token, authority: timestamp.authority, timestampedAt: timestamp.timestampedAt },
    scanStatus: evidence.scanStatus,
    uploadedBy: evidence.uploadedBy,
    createdAt: evidence.createdAt,
  };
}
