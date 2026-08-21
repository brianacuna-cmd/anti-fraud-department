import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { Case } from '../domain/model/aggregates/Case.js';
import type { CaseRepository } from '../domain/ports/CaseRepository.js';
import type { TimelineRecorder } from '../domain/ports/TimelineRecorder.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import type { TimelineEventId } from '../domain/model/value-objects/TimelineEventId.js';
import { CaseTimelineEvent } from '../domain/model/aggregates/CaseTimelineEvent.js';
import { createCaseId } from '../domain/model/value-objects/CaseId.js';
import { caseNotFound, forbiddenCrossTenant } from '../domain/errors/CaseManagementError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireOperationalRole, CASE_WORK_ROLES } from './authorization/policy.js';

export interface StartReviewInput {
  readonly auth: AuthContext;
  readonly caseId: string;
}

export interface StartReviewDeps {
  readonly cases: CaseRepository;
  readonly timelineRecorder: TimelineRecorder;
  readonly auditRecorder: AuditRecorder;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly generateTimelineEventId: () => TimelineEventId;
}

/**
 * Moves a case OPEN -> IN_REVIEW (the review gate: a case must be reviewed
 * before it can be resolved). ANALYST|SUPERVISOR only — pulling a case into
 * review is case work, and the governance tier (ORGANIZATION, ADMIN, AUDITOR)
 * observes without operating. Within ONE transaction: transition + STATE_CHANGED timeline +
 * START_REVIEW audit. An illegal transition (e.g. already RESOLVED) throws
 * `invalidTransition` (422).
 */
export function createStartReviewUseCase(deps: StartReviewDeps) {
  return async function startReview(input: StartReviewInput): Promise<Case> {
    requireOperationalRole(input.auth, CASE_WORK_ROLES);
    const organizationId = requireTenantContext(input.auth);
    const caseId = createCaseId(input.caseId);

    return deps.unitOfWork.withTransaction(async (tx) => {
      const existing = await deps.cases.findById(caseId, tx);
      if (existing === null || existing.deletedAt !== null) {
        throw caseNotFound(caseId);
      }
      if (existing.organizationId !== organizationId) {
        throw forbiddenCrossTenant('case does not belong to the actor organization');
      }

      const now = deps.clock.now();
      const previousStatus = existing.status;
      const reviewed = existing.transitionTo('IN_REVIEW', now);
      await deps.cases.save(reviewed, tx);

      await deps.timelineRecorder.record(
        CaseTimelineEvent.create({
          id: deps.generateTimelineEventId(),
          caseId,
          eventType: 'STATE_CHANGED',
          previousValue: previousStatus,
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
          action: 'START_REVIEW',
          resource: 'case',
          resourceId: caseId,
          detail: { previousStatus },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );

      return reviewed;
    });
  };
}
