import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { CaseTimelineEvent } from '../domain/model/aggregates/CaseTimelineEvent.js';
import type { TimelineRecorder } from '../domain/ports/TimelineRecorder.js';
import type { CaseRepository } from '../domain/ports/CaseRepository.js';
import { createCaseId } from '../domain/model/value-objects/CaseId.js';
import { caseNotFound, forbiddenCrossTenant } from '../domain/errors/CaseManagementError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface GetCaseTimelineInput {
  readonly auth: AuthContext;
  readonly caseId: string;
}

export interface GetCaseTimelineDeps {
  readonly cases: CaseRepository;
  readonly timelineRecorder: TimelineRecorder;
}

export function createGetCaseTimelineUseCase(deps: GetCaseTimelineDeps) {
  return async function getCaseTimeline(input: GetCaseTimelineInput): Promise<readonly CaseTimelineEvent[]> {
    const caseId = createCaseId(input.caseId);
    const kase = await deps.cases.findById(caseId);
    if (!kase) {
      throw caseNotFound(input.caseId);
    }
    if (input.auth.actorType !== 'PLATFORM_ADMIN' && input.auth.organizationId && kase.organizationId !== input.auth.organizationId) {
      throw forbiddenCrossTenant();
    }
    return deps.timelineRecorder.listByCaseId(input.caseId);
  };
}
