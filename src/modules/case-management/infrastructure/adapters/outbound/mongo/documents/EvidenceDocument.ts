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
   * Antivirus verdict (INV-015). `null` on documents written before scanning
   * existed: they rehydrate as `SKIPPED`, which is the truth —nobody looked
   * at them— and not `CLEAN`, which would be a made-up claim about files
   * already on the case.
   */
  readonly scan_status: string | null;
  readonly uploaded_by: string;
  readonly created_at: Date;
  readonly deleted_at: Date | null;
}
