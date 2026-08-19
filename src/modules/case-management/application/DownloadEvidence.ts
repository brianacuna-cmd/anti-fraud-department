import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Evidence } from '../domain/model/aggregates/Evidence.js';
import type { EvidenceRepository } from '../domain/ports/EvidenceRepository.js';
import type { EvidenceStore } from '../domain/ports/EvidenceStore.js';
import { createEvidenceId } from '../domain/model/value-objects/EvidenceId.js';
import { evidenceNotFound, forbiddenCrossTenant } from '../domain/errors/CaseManagementError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface DownloadEvidenceInput {
  readonly auth: AuthContext;
  readonly evidenceId: string;
}

export interface DownloadEvidenceResult {
  readonly evidence: Evidence;
  readonly bytes: Buffer;
}

export interface DownloadEvidenceDeps {
  readonly evidence: EvidenceRepository;
  readonly evidenceStore: EvidenceStore;
}

/**
 * Streams an evidence blob (metadata + bytes), tenant-scoped. A missing
 * metadata row OR a missing blob is a 404 (`evidenceNotFound`); another org's
 * evidence is a 403.
 */
export function createDownloadEvidenceUseCase(deps: DownloadEvidenceDeps) {
  return async function downloadEvidence(input: DownloadEvidenceInput): Promise<DownloadEvidenceResult> {
    const organizationId = requireTenantContext(input.auth);
    const evidenceId = createEvidenceId(input.evidenceId);

    const evidence = await deps.evidence.findById(evidenceId);
    if (evidence === null || evidence.deletedAt !== null) {
      throw evidenceNotFound(evidenceId);
    }
    if (evidence.organizationId !== organizationId) {
      throw forbiddenCrossTenant('evidence does not belong to the actor organization');
    }

    const bytes = await deps.evidenceStore.get(evidence.storageKey);
    if (bytes === null) {
      throw evidenceNotFound(evidenceId);
    }
    return { evidence, bytes };
  };
}
