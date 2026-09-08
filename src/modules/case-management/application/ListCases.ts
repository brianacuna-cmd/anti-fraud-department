import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Instant } from '../../../shared/time/Instant.js';
import type { CaseRepository, CaseListResult } from '../domain/ports/CaseRepository.js';
import type { CaseStatus } from '../domain/model/value-objects/CaseStatus.js';
import type { CasePriority } from '../domain/model/value-objects/CasePriority.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface ListCasesInput {
  readonly auth: AuthContext;
  readonly customerId?: string;
  readonly status?: readonly CaseStatus[];
  readonly priority?: readonly CasePriority[];
  readonly assignedToId?: string;
  readonly riskScoreMin?: number;
  readonly riskScoreMax?: number;
  readonly tags?: readonly string[];
  readonly dueAfter?: Instant;
  readonly dueBefore?: Instant;
  readonly limit: number;
  readonly offset: number;
}

export interface ListCasesDeps {
  readonly cases: CaseRepository;
}

/**
 * Inbox list (PR3). Tenant-scopes the CaseRepository.list query and returns
 * a filtered, paginated page (soft-deletes excluded; dueDate ASC nulls last).
 */
export function createListCasesUseCase(deps: ListCasesDeps) {
  return async function listCases(input: ListCasesInput): Promise<CaseListResult> {
    const organizationId = requireTenantContext(input.auth);
    return deps.cases.list({
      organizationId,
      customerId: input.customerId,
      status: input.status,
      priority: input.priority,
      assignedToId: input.assignedToId,
      riskScoreMin: input.riskScoreMin,
      riskScoreMax: input.riskScoreMax,
      tags: input.tags,
      dueAfter: input.dueAfter,
      dueBefore: input.dueBefore,
      limit: input.limit,
      offset: input.offset,
    });
  };
}
