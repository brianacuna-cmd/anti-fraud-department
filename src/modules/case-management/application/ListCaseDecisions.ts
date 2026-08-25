import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { AnalystDecision } from '../domain/model/aggregates/AnalystDecision.js';
import type { AnalystDecisionRepository } from '../domain/ports/AnalystDecisionRepository.js';
import type { CaseRepository } from '../domain/ports/CaseRepository.js';
import { createCaseId } from '../domain/model/value-objects/CaseId.js';
import { caseNotFound, forbiddenCrossTenant } from '../domain/errors/CaseManagementError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface ListCaseDecisionsInput {
  readonly auth: AuthContext;
  readonly caseId: string;
}

export interface ListCaseDecisionsDeps {
  readonly cases: CaseRepository;
  readonly analystDecisions: AnalystDecisionRepository;
}

/**
 * GET /cases/:caseId/decisions — the decisions already issued on a case.
 *
 * It was missing, and it showed: the case file opened every case saying
 * "Undecided" because it had nowhere to read them from, and only showed the
 * decision recorded in that same session. An already resolved case looked
 * like a newly opened one.
 *
 * Pure read, no role gate: whoever can see the case can see what was
 * concluded about it — denying that to the auditor would deny them exactly
 * what they came to audit. The same doors as `GetCase`: tenant and
 * soft-delete.
 */
export function createListCaseDecisionsUseCase(deps: ListCaseDecisionsDeps) {
  return async function listCaseDecisions(
    input: ListCaseDecisionsInput,
  ): Promise<readonly AnalystDecision[]> {
    const organizationId = requireTenantContext(input.auth);
    const caseId = createCaseId(input.caseId);

    const kase = await deps.cases.findById(caseId);
    if (kase === null || kase.deletedAt !== null) {
      throw caseNotFound(caseId);
    }
    if (kase.organizationId !== organizationId) {
      throw forbiddenCrossTenant('case does not belong to the actor organization');
    }

    return deps.analystDecisions.findByCaseId(caseId);
  };
}
