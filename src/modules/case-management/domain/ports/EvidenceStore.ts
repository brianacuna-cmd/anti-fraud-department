/**
 * Object-store seam for evidence blobs (outside Mongo). The composition root
 * wires a concrete adapter (filesystem for dev; S3/GCS later) selected by env.
 * `put` is idempotent by `storageKey`; `get` returns null when absent.
 */
export interface EvidenceStore {
  put(storageKey: string, bytes: Buffer): Promise<void>;
  get(storageKey: string): Promise<Buffer | null>;
}
