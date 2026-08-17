import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { Case } from '../domain/model/aggregates/Case.js';
import type { CaseRepository } from '../domain/ports/CaseRepository.js';
import type { ResolutionRepository } from '../domain/ports/ResolutionRepository.js';
import type { TimelineRecorder } from '../domain/ports/TimelineRecorder.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import type { ResolutionId } from '../domain/model/value-objects/ResolutionId.js';
import type { TimelineEventId } from '../domain/model/value-objects/TimelineEventId.js';
import type { CaseManagementAuditAction } from '../domain/model/value-objects/CaseManagementAuditVocabulary.js';
import type { ResolutionClosureType } from '../domain/model/aggregates/Resolution.js';
import { Resolution } from '../domain/model/aggregates/Resolution.js';
import { CaseTimelineEvent } from '../domain/model/aggregates/CaseTimelineEvent.js';
import { createCaseId } from '../domain/model/value-objects/CaseId.js';
import { caseNotFound, forbiddenCrossTenant } from '../domain/errors/CaseManagementError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireRole } from './authorization/requireRole.js';

const CLOSE_ROLES = ['SUPERVISOR', 'ADMIN'] as const;

export interface CloseCaseInput {
  readonly auth: AuthContext;
  readonly caseId: string;
  readonly reason: string;
}

export interface CloseCaseDeps {
  readonly cases: CaseRepository;
  readonly resolutions: ResolutionRepository;
  readonly timelineRecorder: TimelineRecorder;
  readonly auditRecorder: AuditRecorder;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly generateResolutionId: () => ResolutionId;
  readonly generateTimelineEventId: () => TimelineEventId;
}

/**
 * Shared closure routine for resolve/archive (case-lifecycle-core PR3).
 * SUPERVISOR|ADMIN only. Within ONE `unitOfWork.withTransaction`: transition
 * the case (throws `invalidTransition`/422 if the edge is illegal), append a
 * `Resolution` row (1:N, historical — reopen never voids it), record a
 * `STATE_CHANGED` timeline event, and audit. Case status finally gets a
 * `transitionTo` caller.
 */
export function closeCase(
  deps: CloseCaseDeps,
  closureType: ResolutionClosureType,
  auditAction: CaseManagementAuditAction,
) {
  return async function close(input: CloseCaseInput): Promise<Case> {
    requireRole(input.auth, CLOSE_ROLES);
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
      const closed = existing.transitionTo(closureType, now);
      await deps.cases.save(closed, tx);

      const resolution = Resolution.create({
        id: deps.generateResolutionId(),
        caseId,
        organizationId,
        closureType,
        reason: input.reason,
        resolvedBy: input.auth.userId,
        now,
      });
      await deps.resolutions.save(resolution, tx);

      await deps.timelineRecorder.record(
        CaseTimelineEvent.create({
          id: deps.generateTimelineEventId(),
          caseId,
          eventType: 'STATE_CHANGED',
          previousValue: previousStatus,
          newValue: closureType,
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
          action: auditAction,
          resource: 'case',
          resourceId: caseId,
          detail: { closureType, reason: resolution.reason, resolutionId: resolution.id },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );

      return closed;
    });
  };
}
