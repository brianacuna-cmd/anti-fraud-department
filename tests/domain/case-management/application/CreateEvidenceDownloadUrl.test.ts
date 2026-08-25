import { oid } from '../../../support/oid.js';
import {
  createCreateEvidenceDownloadUrlUseCase,
  EVIDENCE_URL_TTL_SECONDS,
} from '../../../../src/modules/case-management/application/CreateEvidenceDownloadUrl.js';
import { Evidence } from '../../../../src/modules/case-management/domain/model/aggregates/Evidence.js';
import { createEvidenceId } from '../../../../src/modules/case-management/domain/model/value-objects/EvidenceId.js';
import { createCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { InMemoryEvidenceRepository } from '../../../helpers/case-management/InMemoryEvidenceRepository.js';
import { InMemoryEvidenceStore } from '../../../helpers/case-management/InMemoryEvidenceStore.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { fromDate, toDate } from '../../../../src/shared/time/Instant.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { CaseManagementError } from '../../../../src/modules/case-management/domain/errors/CaseManagementError.js';
import type { EvidenceStore } from '../../../../src/modules/case-management/domain/ports/EvidenceStore.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_1 = oid('org-1');
const ORG_2 = oid('org-2');
const EVIDENCE_ID = createEvidenceId(oid('ev-1'));
const CASE_ID = createCaseId(oid('case-1'));

const ANALYST = createAuthContext({
  userId: oid('analyst-1'),
  organizationId: ORG_1,
  actorType: 'USER',
  roleId: 'ANALYST',
});

function buildEvidence(organizationId = ORG_1, deleted = false): Evidence {
  const evidence = Evidence.register({
    id: EVIDENCE_ID,
    caseId: CASE_ID,
    investigationId: null,
    organizationId,
    filename: 'extracto.pdf',
    contentType: 'application/pdf',
    byteSize: 1024,
    sha256: 'a'.repeat(64),
    storageKey: 'org/case/ev-1',
    timestamp: null,
    scanStatus: 'CLEAN',
    uploadedBy: oid('analyst-1'),
    now: NOW,
  });
  return deleted ? evidence.softDelete(NOW) : evidence;
}

/** Store that can actually sign, like the S3 one. */
class SigningStore extends InMemoryEvidenceStore implements EvidenceStore {
  readonly requested: Array<{ key: string; ttl: number }> = [];

  async presignDownload(storageKey: string, expiresInSeconds: number): Promise<string> {
    this.requested.push({ key: storageKey, ttl: expiresInSeconds });
    return `https://bucket.example/${storageKey}?X-Amz-Expires=${expiresInSeconds}`;
  }
}

function setup(store: EvidenceStore) {
  const evidence = new InMemoryEvidenceRepository();
  const useCase = createCreateEvidenceDownloadUrlUseCase({
    evidence,
    evidenceStore: store,
    clock: new FixedClock(NOW),
  });
  return { evidence, useCase };
}

describe('CreateEvidenceDownloadUrl (INV-004)', () => {
  it('firma la URL y calcula su caducidad', async () => {
    const store = new SigningStore();
    const { evidence, useCase } = setup(store);
    await evidence.save(buildEvidence());

    const result = await useCase({ auth: ANALYST, evidenceId: EVIDENCE_ID });

    expect(result.url).toContain('org/case/ev-1');
    expect(store.requested).toEqual([{ key: 'org/case/ev-1', ttl: EVIDENCE_URL_TTL_SECONDS }]);
    expect(toDate(result.expiresAt).getTime() - toDate(NOW).getTime()).toBe(
      EVIDENCE_URL_TTL_SECONDS * 1000,
    );
  });

  it('falla explícitamente si el almacén no sabe firmar', async () => {
    // The filesystem store cannot issue anything the browser can reach without
    // going through the API. Inventing a URL would be worse than failing.
    const { evidence, useCase } = setup(new InMemoryEvidenceStore());
    await evidence.save(buildEvidence());

    await expect(useCase({ auth: ANALYST, evidenceId: EVIDENCE_ID })).rejects.toThrow(
      /cannot issue presigned URLs/,
    );
  });

  it('404 cuando la evidencia no existe', async () => {
    const { useCase } = setup(new SigningStore());

    await expect(useCase({ auth: ANALYST, evidenceId: EVIDENCE_ID })).rejects.toThrow(
      CaseManagementError,
    );
  });

  it('404 cuando está borrada lógicamente', async () => {
    const store = new SigningStore();
    const { evidence, useCase } = setup(store);
    await evidence.save(buildEvidence(ORG_1, true));

    await expect(useCase({ auth: ANALYST, evidenceId: EVIDENCE_ID })).rejects.toThrow(
      CaseManagementError,
    );
    // And above all: nothing was signed. A URL already issued no longer comes through here.
    expect(store.requested).toEqual([]);
  });

  it('403 y sin firmar cuando es de otro inquilino', async () => {
    const store = new SigningStore();
    const { evidence, useCase } = setup(store);
    await evidence.save(buildEvidence(ORG_2));

    await expect(useCase({ auth: ANALYST, evidenceId: EVIDENCE_ID })).rejects.toThrow(
      /does not belong/,
    );
    expect(store.requested).toEqual([]);
  });
});
