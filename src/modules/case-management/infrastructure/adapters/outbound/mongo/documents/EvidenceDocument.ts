/**
 * Mongo document shape for `evidence` (metadata only — the blob lives in the
 * object store). Append-only. `timestamp` is the optional RFC3161 seal.
 */

import type { ObjectId } from 'mongodb';

export interface EvidenceTimestampDocument {
  readonly token: string;
  readonly authority: string;
  readonly timestamped_at: Date;
}

export interface EvidenceDocument {
  readonly _id: ObjectId;
  readonly case_id: ObjectId;
  readonly investigation_id: ObjectId | null;
  readonly organization_id: ObjectId;
  readonly filename: string;
  readonly content_type: string;
  readonly byte_size: number;
  readonly sha256: string;
  readonly storage_key: string;
  readonly timestamp: EvidenceTimestampDocument | null;
  /**
   * Veredicto del antivirus (INV-015). `null` en los documentos escritos antes
   * de que existiera el escaneo: se rehidratan como `SKIPPED`, que es la
   * verdad —nadie los miro— y no `CLEAN`, que seria una afirmacion inventada
   * sobre ficheros que ya estan en el expediente.
   */
  readonly scan_status: string | null;
  readonly uploaded_by: string;
  readonly created_at: Date;
  readonly deleted_at: Date | null;
}
