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
   * Veredicto del antivirus (INV-015). Se expone porque el panel tiene que
   * poder distinguir "se analizo y estaba limpio" de "no lo miro nadie": si el
   * front no puede verlo, el estado SKIPPED no existe para quien instruye el
   * expediente y la honestidad del dato se queda dentro de la base.
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
