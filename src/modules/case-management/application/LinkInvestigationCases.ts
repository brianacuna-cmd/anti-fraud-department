import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { Investigation } from '../domain/model/aggregates/Investigation.js';
import type { InvestigationRepository } from '../domain/ports/InvestigationRepository.js';
import type { CaseRepository } from '../domain/ports/CaseRepository.js';
import type { TimelineRecorder } from '../domain/ports/TimelineRecorder.js';
import type { UnitOfWork, Transaction } from '../domain/ports/UnitOfWork.js';
import type { TimelineEventId } from '../domain/model/value-objects/TimelineEventId.js';
import type { CaseId } from '../domain/model/value-objects/CaseId.js';
import { CaseTimelineEvent } from '../domain/model/aggregates/CaseTimelineEvent.js';
import { createInvestigationId } from '../domain/model/value-objects/InvestigationId.js';
import { createCaseId } from '../domain/model/value-objects/CaseId.js';
import {
  investigationNotFound,
  caseNotFound,
  forbiddenCrossTenant,
  invariantViolation,
} from '../domain/errors/CaseManagementError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireOperationalRole, CASE_WORK_ROLES } from './authorization/policy.js';

const MAX_LINKED_CASES = 100;

export interface LinkInvestigationCasesInput {
  readonly auth: AuthContext;
  readonly investigationId: string;
  readonly caseIds: readonly string[];
}

export interface LinkInvestigationCasesDeps {
  readonly investigations: InvestigationRepository;
  readonly cases: CaseRepository;
  readonly timelineRecorder: TimelineRecorder;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly generateTimelineEventId: () => TimelineEventId;
}

/**
 * POST /investigations/:id/link-cases — associates existing cases to a deep
 * investigation. Any authenticated tenant actor; the investigation and every
 * linked case must belong to the actor's org (all-or-nothing validation). The
 * investigation's own primary case and already-linked cases are skipped.
 * Records a CASE_LINKED_TO_INVESTIGATION timeline event on each newly-linked
 * case. Scope: investigations, cases, case_timeline (no audit_logs).
 */
export function createLinkInvestigationCasesUseCase(deps: LinkInvestigationCasesDeps) {
  return async function linkInvestigationCases(
    input: LinkInvestigationCasesInput,
  ): Promise<Investigation> {
    requireOperationalRole(input.auth, CASE_WORK_ROLES);
    const organizationId = requireTenantContext(input.auth);
    const investigationId = createInvestigationId(input.investigationId);
    const caseIds = dedupe(input.caseIds).map(createCaseId);
    if (caseIds.length === 0) {
      throw invariantViolation('link-cases requires at least one case id');
    }
    if (caseIds.length > MAX_LINKED_CASES) {
      throw invariantViolation(`link-cases is limited to ${MAX_LINKED_CASES} cases per request`, {
        received: caseIds.length,
      });
    }

    return deps.unitOfWork.withTransaction(async (tx) => {
      const investigation = await deps.investigations.findById(investigationId, tx);
      if (investigation === null) {
        throw investigationNotFound(investigationId);
      }
      if (investigation.organizationId !== organizationId) {
        throw forbiddenCrossTenant('investigation does not belong to the actor organization');
      }

      await assertCasesExist(caseIds, organizationId, deps, tx);

      const now = deps.clock.now();
      const before = new Set(investigation.linkedCaseIds.map((id) => id as string));
      const linked = investigation.linkCases(caseIds, now);
      const newlyLinked = linked.linkedCaseIds.filter((id) => !before.has(id as string));
      if (newlyLinked.length === 0) {
        return investigation;
      }

      await deps.investigations.save(linked, tx);
      for (const caseId of newlyLinked) {
        await deps.timelineRecorder.record(
          CaseTimelineEvent.create({
            id: deps.generateTimelineEventId(),
            caseId,
            eventType: 'CASE_LINKED_TO_INVESTIGATION',
            previousValue: null,
            newValue: linked.id,
            createdBy: input.auth.userId,
            createdAt: now,
          }),
          tx,
        );
      }
      return linked;
    });
  };
}

async function assertCasesExist(
  caseIds: readonly CaseId[],
  organizationId: string,
  deps: LinkInvestigationCasesDeps,
  tx: Transaction,
): Promise<void> {
  for (const caseId of caseIds) {
    const kase = await deps.cases.findById(caseId, tx);
    if (kase === null || kase.deletedAt !== null) {
      throw caseNotFound(caseId);
    }
    if (kase.organizationId !== organizationId) {
      throw forbiddenCrossTenant('case does not belong to the actor organization');
    }
  }
}

function dedupe(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result;
}
