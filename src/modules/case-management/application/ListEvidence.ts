import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Evidence } from '../domain/model/aggregates/Evidence.js';
import type { CaseRepository } from '../domain/ports/CaseRepository.js';
import type { EvidenceRepository } from '../domain/ports/EvidenceRepository.js';
import { createCaseId } from '../domain/model/value-objects/CaseId.js';
import { caseNotFound, forbiddenCrossTenant } from '../domain/errors/CaseManagementError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface ListEvidenceInput {
  readonly auth: AuthContext;
  readonly caseId: string;
}

export interface ListEvidenceDeps {
  readonly cases: CaseRepository;
  readonly evidence: EvidenceRepository;
}

/** Lists a case's evidence (metadata) behind the same tenant + soft-delete gates as `GetCase`. */
export function createListEvidenceUseCase(deps: ListEvidenceDeps) {
  return async function listEvidence(input: ListEvidenceInput): Promise<Evidence[]> {
    const organizationId = requireTenantContext(input.auth);
    const caseId = createCaseId(input.caseId);

    const kase = await deps.cases.findById(caseId);
    if (kase === null || kase.deletedAt !== null) {
      throw caseNotFound(caseId);
    }
    if (kase.organizationId !== organizationId) {
      throw forbiddenCrossTenant('case does not belong to the actor organization');
    }
    return deps.evidence.listByCaseId(caseId);
  };
}
