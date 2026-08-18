import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { EvidenceStore } from '../../../../domain/ports/EvidenceStore.js';

/**
 * Filesystem-backed `EvidenceStore` for development: blobs live under
 * `baseDir/<storageKey>`. The S3/GCS adapter slots in behind the same port
 * later without touching the domain. `storageKey` is composed of ObjectId hex
 * segments (`org/case/evidence`), so no path traversal is possible.
 */
export class FilesystemEvidenceStore implements EvidenceStore {
  constructor(private readonly baseDir: string) {}

  async put(storageKey: string, bytes: Buffer): Promise<void> {
    const path = join(this.baseDir, storageKey);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }

  async get(storageKey: string): Promise<Buffer | null> {
    try {
      return await readFile(join(this.baseDir, storageKey));
    } catch (error) {
      if (isNotFound(error)) {
        return null;
      }
      throw error;
    }
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ENOENT';
}
