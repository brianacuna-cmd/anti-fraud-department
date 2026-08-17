import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Case } from '../domain/model/aggregates/Case.js';
import type { CaseRepository } from '../domain/ports/CaseRepository.js';
import { createCaseId } from '../domain/model/value-objects/CaseId.js';
import { caseNotFound, forbiddenCrossTenant } from '../domain/errors/CaseManagementError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface GetCaseInput {
  readonly auth: AuthContext;
  readonly caseId: string;
}

export interface GetCaseDeps {
  readonly cases: CaseRepository;
}

export function createGetCaseUseCase(deps: GetCaseDeps) {
  return async function getCase(input: GetCaseInput): Promise<Case> {
    const caseId = createCaseId(input.caseId);
    const kase = await deps.cases.findById(caseId);
    if (!kase) {
      throw caseNotFound(input.caseId);
    }
    if (input.auth.actorType !== 'PLATFORM_ADMIN' && input.auth.organizationId && kase.organizationId !== input.auth.organizationId) {
      throw forbiddenCrossTenant();
    }
    return kase;
  };
}
