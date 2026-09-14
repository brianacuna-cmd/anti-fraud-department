import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { Case } from '../domain/model/aggregates/Case.js';
import type { CaseRepository } from '../domain/ports/CaseRepository.js';
import type { TimelineRecorder } from '../domain/ports/TimelineRecorder.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import type { TimelineEventId } from '../domain/model/value-objects/TimelineEventId.js';
import { CaseTimelineEvent } from '../domain/model/aggregates/CaseTimelineEvent.js';
import { invalidTransition } from '../domain/errors/CaseManagementError.js';
import { requireOperationalRole, CASE_WORK_ROLES } from './authorization/policy.js';
import { loadWorkableCase } from './loadWorkableCase.js';

export interface ResumeCaseReviewInput {
  readonly auth: AuthContext;
  readonly caseId: string;
}

export interface ResumeCaseReviewDeps {
  readonly cases: CaseRepository;
  readonly timelineRecorder: TimelineRecorder;
  readonly auditRecorder: AuditRecorder;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly generateTimelineEventId: () => TimelineEventId;
}

/**
 * Brings a case back PENDING_DOCUMENTATION -> IN_REVIEW once the requested
 * documents arrive (they are attached as evidence, which is already allowed
 * while pending). ANALYST|SUPERVISOR only.
 *
 * Only valid from PENDING_DOCUMENTATION: `StartReview` owns OPEN -> IN_REVIEW,
 * and the table alone would not tell the two doors apart. The SLA is left
 * untouched, same as when the documentation was requested.
 */
export function createResumeCaseReviewUseCase(deps: ResumeCaseReviewDeps) {
  return async function resumeCaseReview(input: ResumeCaseReviewInput): Promise<Case> {
    requireOperationalRole(input.auth, CASE_WORK_ROLES);

    return deps.unitOfWork.withTransaction(async (tx) => {
      const { existing, organizationId } = await loadWorkableCase(deps.cases, input, tx);
      if (existing.status !== 'PENDING_DOCUMENTATION') {
        throw invalidTransition(existing.status, 'IN_REVIEW');
      }

      const now = deps.clock.now();
      const resumed = existing.transitionTo('IN_REVIEW', now);
      await deps.cases.save(resumed, tx);

      await deps.timelineRecorder.record(
        CaseTimelineEvent.create({
          id: deps.generateTimelineEventId(),
          caseId: resumed.id,
          eventType: 'STATE_CHANGED',
          previousValue: 'PENDING_DOCUMENTATION',
          newValue: 'IN_REVIEW',
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
          action: 'RESUME_CASE_REVIEW',
          resource: 'case',
          resourceId: resumed.id,
          detail: { previousStatus: 'PENDING_DOCUMENTATION' },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );

      return resumed;
    });
  };
}
