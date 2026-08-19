import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { CaseListFilter, CaseListPage, CaseRepository } from '../domain/ports/CaseRepository.js';

/** Hard ceiling on page size: an unbounded `limit` is a denial-of-service knob. */
const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

export interface ListCasesInput {
  readonly auth: AuthContext;
  readonly limit?: number;
  readonly cursor?: string;
  readonly status?: string | readonly string[];
  readonly priority?: string | readonly string[];
  readonly assignedToId?: string;
  readonly assignedToType?: string;
  readonly tags?: readonly string[];
  readonly riskScoreMin?: number;
  readonly riskScoreMax?: number;
  readonly createdFrom?: string;
  readonly createdTo?: string;
  readonly dueBefore?: string;
  readonly overdueOnly?: boolean;
  readonly search?: string;
}

export interface ListCasesDeps {
  readonly cases: CaseRepository;
}

/**
 * Builds the repository filter shared by CASE-004 (list) and CASE-013
 * (export), so a CSV can never contain rows the equivalent listing hides.
 *
 * Tenant scoping is decided here and nowhere else: a PLATFORM_ADMIN spans
 * every organization (`null`), anyone else is pinned to their own. The
 * transport may not override it — passing `organizationId` from a query
 * string would turn the filter into a tenant-escape hatch.
 */
export function toCaseListFilter(input: ListCasesInput): CaseListFilter {
  const requestedLimit = Math.trunc(input.limit ?? DEFAULT_LIMIT);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;

  return {
    organizationId: input.auth.actorType === 'PLATFORM_ADMIN' ? null : input.auth.organizationId,
    limit,
    cursor: input.cursor,
    status: input.status,
    priority: input.priority,
    assignedToId: input.assignedToId,
    assignedToType: input.assignedToType,
    tags: input.tags,
    riskScoreMin: input.riskScoreMin,
    riskScoreMax: input.riskScoreMax,
    createdFrom: input.createdFrom,
    createdTo: input.createdTo,
    dueBefore: input.dueBefore,
    overdueOnly: input.overdueOnly,
    search: input.search,
  };
}

export function createListCasesUseCase(deps: ListCasesDeps) {
  return async function listCases(input: ListCasesInput): Promise<CaseListPage> {
    return deps.cases.list(toCaseListFilter(input));
  };
}
