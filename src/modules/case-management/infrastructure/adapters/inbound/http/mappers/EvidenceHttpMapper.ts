import type { Evidence } from '../../../../../domain/model/aggregates/Evidence.js';

export interface EvidenceDto {
  readonly id: string;
  readonly caseId: string;
  readonly investigationId: string | null;
  readonly filename: string;
  readonly contentType: string;
  readonly byteSize: number;
  readonly sha256: string;
  readonly timestamp: { readonly token: string; readonly authority: string; readonly timestampedAt: string } | null;
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
    uploadedBy: evidence.uploadedBy,
    createdAt: evidence.createdAt,
  };
}
