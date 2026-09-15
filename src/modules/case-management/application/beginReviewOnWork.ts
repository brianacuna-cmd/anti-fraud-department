import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { Case } from '../domain/model/aggregates/Case.js';
import type { CaseRepository } from '../domain/ports/CaseRepository.js';
import type { TimelineRecorder } from '../domain/ports/TimelineRecorder.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { Transaction } from '../domain/ports/UnitOfWork.js';
import type { TimelineEventId } from '../domain/model/value-objects/TimelineEventId.js';
import { CaseTimelineEvent } from '../domain/model/aggregates/CaseTimelineEvent.js';

export interface BeginReviewDeps {
  readonly cases: CaseRepository;
  readonly timelineRecorder: TimelineRecorder;
  readonly auditRecorder: AuditRecorder;
  readonly clock: Clock;
  readonly generateTimelineEventId: () => TimelineEventId;
}

/**
 * Moves an OPEN case to IN_REVIEW inside the caller's transaction, with the
 * same STATE_CHANGED timeline event and START_REVIEW audit row as the
 * explicit start-review route. Any other status is returned untouched.
 *
 * Working a case IS reviewing it: the first note, piece of evidence,
 * decision or documentation request starts the review instead of failing
 * with CASE_NOT_REVIEWED and asking for an extra empty click first.
 * `trigger` records which act started it.
 */
export async function beginReviewOnWork(
  deps: BeginReviewDeps,
  kase: Case,
  auth: AuthContext,
  trigger: string,
  tx: Transaction | undefined,
): Promise<Case> {
  if (kase.status !== 'OPEN') {
    return kase;
  }
  const now = deps.clock.now();
  const reviewed = kase.transitionTo('IN_REVIEW', now);
  await deps.cases.save(reviewed, tx);

  await deps.timelineRecorder.record(
    CaseTimelineEvent.create({
      id: deps.generateTimelineEventId(),
      caseId: kase.id,
      eventType: 'STATE_CHANGED',
      previousValue: kase.status,
      newValue: 'IN_REVIEW',
      createdBy: auth.userId,
      createdAt: now,
    }),
    tx,
  );

  await deps.auditRecorder.record(
    {
      organizationId: kase.organizationId,
      actorType: auth.actorType,
      actorId: auth.userId,
      action: 'START_REVIEW',
      resource: 'case',
      resourceId: kase.id,
      detail: { previousStatus: kase.status, trigger },
      ipAddress: auth.ipAddress,
    },
    tx,
  );
  return reviewed;
}
