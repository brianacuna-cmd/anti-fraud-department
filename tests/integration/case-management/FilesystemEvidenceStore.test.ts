import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FilesystemEvidenceStore } from '../../../src/modules/case-management/infrastructure/adapters/outbound/storage/FilesystemEvidenceStore.js';

describe('FilesystemEvidenceStore', () => {
  let baseDir: string;

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'evidence-'));
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it('puts and gets a blob by nested storage key (creates parent dirs)', async () => {
    const store = new FilesystemEvidenceStore(baseDir);
    const bytes = Buffer.from('an evidence PDF');

    await store.put('org-1/case-1/ev-1', bytes);

    expect(await store.get('org-1/case-1/ev-1')).toEqual(bytes);
  });

  it('returns null for a missing storage key', async () => {
    const store = new FilesystemEvidenceStore(baseDir);
    expect(await store.get('org-1/case-1/nope')).toBeNull();
  });
});
