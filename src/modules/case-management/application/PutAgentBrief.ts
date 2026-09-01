import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import { SYSTEM_AGENT_USER_ID } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { Case } from '../domain/model/aggregates/Case.js';
import type { CaseRepository } from '../domain/ports/CaseRepository.js';
import type { TimelineRecorder } from '../domain/ports/TimelineRecorder.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import type { TimelineEventId } from '../domain/model/value-objects/TimelineEventId.js';
import { CaseTimelineEvent } from '../domain/model/aggregates/CaseTimelineEvent.js';
import { createCaseId } from '../domain/model/value-objects/CaseId.js';
import { caseNotFound, forbiddenCrossTenant, forbiddenRole } from '../domain/errors/CaseManagementError.js';
import { assertNotClosed } from '../domain/services/ClosedCaseGate.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface PutAgentBriefInput {
  readonly auth: AuthContext;
  readonly caseId: string;
  readonly brief: string;
}

export interface PutAgentBriefDeps {
  readonly cases: CaseRepository;
  readonly timelineRecorder: TimelineRecorder;
  readonly auditRecorder: AuditRecorder;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly generateTimelineEventId: () => TimelineEventId;
}

/** Agent-only last-write-wins brief. Skips AssignmentGate for `system:agent`. No CaseNote. */
export function createPutAgentBriefUseCase(deps: PutAgentBriefDeps) {
  return async function putAgentBrief(input: PutAgentBriefInput): Promise<Case> {
    const organizationId = requireTenantContext(input.auth);
    if (input.auth.userId !== SYSTEM_AGENT_USER_ID) {
      throw forbiddenRole(input.auth.roleId, [SYSTEM_AGENT_USER_ID]);
    }
    const caseId = createCaseId(input.caseId);
    const brief = input.brief.trim();

    return deps.unitOfWork.withTransaction(async (tx) => {
      const kase = await deps.cases.findById(caseId, tx);
      if (kase === null || kase.deletedAt !== null) {
        throw caseNotFound(caseId);
      }
      if (kase.organizationId !== organizationId) {
        throw forbiddenCrossTenant('case does not belong to the actor organization');
      }
      assertNotClosed(kase);

      const now = deps.clock.now();
      const previousValue = kase.agentBrief;
      const updated = kase.withAgentBrief(brief, now);
      await deps.cases.save(updated, tx);
      await deps.timelineRecorder.record(
        CaseTimelineEvent.create({
          id: deps.generateTimelineEventId(),
          caseId,
          eventType: 'AGENT_BRIEFING',
          previousValue,
          newValue: brief,
          createdBy: input.auth.userId,
          createdAt: now,
        }),
        tx,
      );
      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: 'PUT_AGENT_BRIEF',
          resource: 'case',
          resourceId: caseId,
          detail: {},
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );
      return updated;
    });
  };
}
