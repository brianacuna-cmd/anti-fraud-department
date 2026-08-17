import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { CaseListPage, CaseRepository } from '../domain/ports/CaseRepository.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface ListCasesInput {
  readonly auth: AuthContext;
  readonly limit?: number;
  readonly cursor?: string;
  readonly status?: string;
}

export interface ListCasesDeps {
  readonly cases: CaseRepository;
}

export function createListCasesUseCase(deps: ListCasesDeps) {
  return async function listCases(input: ListCasesInput): Promise<CaseListPage> {
    const organizationId = input.auth.actorType === 'PLATFORM_ADMIN' ? null : input.auth.organizationId;
    return deps.cases.list(organizationId, input.limit ?? 50, input.cursor, input.status);
  };
}
