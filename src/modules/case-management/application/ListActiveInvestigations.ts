import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Investigation } from '../domain/model/aggregates/Investigation.js';
import type { InvestigationRepository } from '../domain/ports/InvestigationRepository.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface ListActiveInvestigationsInput {
  readonly auth: AuthContext;
}

export interface ListActiveInvestigationsDeps {
  readonly investigations: InvestigationRepository;
}

/**
 * GET /investigations — lists the active (OPEN|INVESTIGATING) investigations
 * for the caller's organization, newest-first. Any authenticated tenant actor
 * (mirrors the other investigation reads). Scope: investigations (read-only).
 */
export function createListActiveInvestigationsUseCase(deps: ListActiveInvestigationsDeps) {
  return async function listActiveInvestigations(
    input: ListActiveInvestigationsInput,
  ): Promise<Investigation[]> {
    const organizationId = requireTenantContext(input.auth);
    return deps.investigations.listActiveByOrganization(organizationId);
  };
}
