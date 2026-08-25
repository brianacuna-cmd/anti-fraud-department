/**
 * Object-store seam for evidence blobs (outside Mongo). The composition root
 * wires a concrete adapter (filesystem for dev; S3 in deployment) selected by
 * env. `put` is idempotent by `storageKey`; `get` returns null when absent.
 */
export interface EvidenceStore {
  put(storageKey: string, bytes: Buffer, contentType?: string): Promise<void>;
  get(storageKey: string): Promise<Buffer | null>;
  /**
   * Presigned URL for a direct download (INV-004), or `undefined` if the
   * adapter cannot issue them.
   *
   * It is OPTIONAL on purpose. Signing a URL is a capability of the object
   * store, not of the port: the filesystem adapter cannot issue anything the
   * browser can reach without going through the API. Making it required would
   * force that adapter to return a fake URL or to throw, and both move the
   * problem to runtime. This way, whoever needs it asks whether it exists
   * and decides.
   */
  presignDownload?(storageKey: string, expiresInSeconds: number): Promise<string>;
}
