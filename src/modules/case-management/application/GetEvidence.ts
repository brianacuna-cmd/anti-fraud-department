import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Evidence } from '../domain/model/aggregates/Evidence.js';
import type { EvidenceRepository } from '../domain/ports/EvidenceRepository.js';
import { createEvidenceId } from '../domain/model/value-objects/EvidenceId.js';
import { evidenceNotFound, forbiddenCrossTenant } from '../domain/errors/CaseManagementError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface GetEvidenceInput {
  readonly auth: AuthContext;
  readonly evidenceId: string;
}

export interface GetEvidenceDeps {
  readonly evidence: EvidenceRepository;
}

/** Reads evidence metadata by id, tenant-scoped (404 missing / 403 cross-tenant). */
export function createGetEvidenceUseCase(deps: GetEvidenceDeps) {
  return async function getEvidence(input: GetEvidenceInput): Promise<Evidence> {
    const organizationId = requireTenantContext(input.auth);
    const evidenceId = createEvidenceId(input.evidenceId);

    const evidence = await deps.evidence.findById(evidenceId);
    if (evidence === null) {
      throw evidenceNotFound(evidenceId);
    }
    if (evidence.organizationId !== organizationId) {
      throw forbiddenCrossTenant('evidence does not belong to the actor organization');
    }
    return evidence;
  };
}
