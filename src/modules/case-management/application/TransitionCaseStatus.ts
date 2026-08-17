import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { CaseRepository } from '../domain/ports/CaseRepository.js';
import type { TimelineRecorder } from '../domain/ports/TimelineRecorder.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { TimelineEventId } from '../domain/model/value-objects/TimelineEventId.js';
import type { Case } from '../domain/model/aggregates/Case.js';
import { CaseTimelineEvent } from '../domain/model/aggregates/CaseTimelineEvent.js';
import { createCaseId } from '../domain/model/value-objects/CaseId.js';
import { createCaseStatus } from '../domain/model/value-objects/CaseStatus.js';
import { caseNotFound, forbiddenCrossTenant } from '../domain/errors/CaseManagementError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface TransitionCaseStatusInput {
  readonly auth: AuthContext;
  readonly caseId: string;
  readonly nextStatus: string;
}

export interface TransitionCaseStatusDeps {
  readonly cases: CaseRepository;
  readonly timelineRecorder: TimelineRecorder;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly generateTimelineEventId: () => TimelineEventId;
  readonly auditRecorder: AuditRecorder;
}

export function createTransitionCaseStatusUseCase(deps: TransitionCaseStatusDeps) {
  return async function transitionCaseStatus(input: TransitionCaseStatusInput): Promise<Case> {
    const organizationId = requireTenantContext(input.auth);
    const caseId = createCaseId(input.caseId);
    const nextStatus = createCaseStatus(input.nextStatus);
    const now = deps.clock.now();

    return deps.unitOfWork.withTransaction(async (tx) => {
      const kase = await deps.cases.findById(caseId, tx);
      if (!kase) {
        throw caseNotFound(input.caseId);
      }
      if (input.auth.actorType !== 'PLATFORM_ADMIN' && input.auth.organizationId && kase.organizationId !== input.auth.organizationId) {
        throw forbiddenCrossTenant();
      }

      const previousStatus = kase.status;
      const updatedCase = kase.transitionTo(nextStatus, now);
      await deps.cases.save(updatedCase, tx);

      const timelineEvent = CaseTimelineEvent.create({
        id: deps.generateTimelineEventId(),
        caseId: updatedCase.id,
        eventType: 'STATE_CHANGED',
        previousValue: previousStatus,
        newValue: nextStatus,
        createdBy: input.auth.userId,
        createdAt: now,
      });
      await deps.timelineRecorder.record(timelineEvent, tx);

      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: nextStatus === 'RESOLVED' ? 'RESOLVE_CASE' : 'CREATE_CASE',
          resource: 'case',
          resourceId: updatedCase.id,
          detail: { previousStatus, nextStatus },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );

      return updatedCase;
    });
  };
}
