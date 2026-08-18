import type { EvidenceStore } from '../../../src/modules/case-management/domain/ports/EvidenceStore.js';

/** In-memory `EvidenceStore` fake — a Map from storageKey to bytes. */
export class InMemoryEvidenceStore implements EvidenceStore {
  private readonly blobs = new Map<string, Buffer>();

  async put(storageKey: string, bytes: Buffer): Promise<void> {
    this.blobs.set(storageKey, bytes);
  }

  async get(storageKey: string): Promise<Buffer | null> {
    return this.blobs.get(storageKey) ?? null;
  }
}
