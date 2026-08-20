import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { CaseTimelineEvent } from '../domain/model/aggregates/CaseTimelineEvent.js';
import type { CaseRepository } from '../domain/ports/CaseRepository.js';
import type { TimelineReader } from '../domain/ports/TimelineReader.js';
import { createCaseId } from '../domain/model/value-objects/CaseId.js';
import { caseNotFound, forbiddenCrossTenant } from '../domain/errors/CaseManagementError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface GetCaseTimelineInput {
  readonly auth: AuthContext;
  readonly caseId: string;
}

export interface GetCaseTimelineDeps {
  readonly cases: CaseRepository;
  readonly timelineReader: TimelineReader;
}

/**
 * Reads the append-only timeline of one case, oldest first. Re-uses the same
 * tenant + soft-delete gates as `GetCase` so a caller can only read the log
 * of a case they may see.
 */
export function createGetCaseTimelineUseCase(deps: GetCaseTimelineDeps) {
  return async function getCaseTimeline(input: GetCaseTimelineInput): Promise<CaseTimelineEvent[]> {
    const organizationId = requireTenantContext(input.auth);
    const caseId = createCaseId(input.caseId);

    const kase = await deps.cases.findById(caseId);
    if (kase === null || kase.deletedAt !== null) {
      throw caseNotFound(caseId);
    }
    if (kase.organizationId !== organizationId) {
      throw forbiddenCrossTenant('case does not belong to the actor organization');
    }
    return deps.timelineReader.listByCaseId(caseId);
  };
}
