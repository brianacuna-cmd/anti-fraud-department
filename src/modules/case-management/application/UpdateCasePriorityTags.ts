import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import { fromDate, toDate } from '../../../shared/time/Instant.js';
import type { CaseRepository } from '../domain/ports/CaseRepository.js';
import type { CaseSlaTrackingRepository } from '../domain/ports/CaseSlaTrackingRepository.js';
import type { OrganizationFraudConfigRepository } from '../domain/ports/OrganizationFraudConfigRepository.js';
import type { TimelineRecorder } from '../domain/ports/TimelineRecorder.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import type { TimelineEventId } from '../domain/model/value-objects/TimelineEventId.js';
import type { CaseSlaTrackingId } from '../domain/model/value-objects/CaseSlaTrackingId.js';
import type { Case } from '../domain/model/aggregates/Case.js';
import { normalizeTags } from '../domain/model/aggregates/Case.js';
import { CaseSlaTracking } from '../domain/model/aggregates/CaseSlaTracking.js';
import { CaseTimelineEvent } from '../domain/model/aggregates/CaseTimelineEvent.js';
import { createCaseId } from '../domain/model/value-objects/CaseId.js';
import { createCasePriority } from '../domain/model/value-objects/CasePriority.js';
import {
  caseNotFound,
  forbiddenCrossTenant,
  invariantViolation,
  organizationFraudConfigNotFound,
} from '../domain/errors/CaseManagementError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireRole } from './authorization/requireRole.js';

const MS_PER_MINUTE = 60_000;
const UPDATE_PRIORITY_TAGS_ROLES = ['ANALYST', 'SUPERVISOR', 'ADMIN'] as const;

export interface UpdateCasePriorityTagsInput {
  readonly auth: AuthContext;
  readonly caseId: string;
  readonly priority: string;
  readonly tags: readonly string[];
}

export interface UpdateCasePriorityTagsDeps {
  readonly cases: CaseRepository;
  readonly slaTracking: CaseSlaTrackingRepository;
  readonly fraudConfig: OrganizationFraudConfigRepository;
  readonly timelineRecorder: TimelineRecorder;
  readonly auditRecorder: AuditRecorder;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly generateTimelineEventId: () => TimelineEventId;
  readonly generateCaseSlaTrackingId: () => CaseSlaTrackingId;
}

/**
 * PATCH /cases/:id/priority-tags. Role-gated to ANALYST|SUPERVISOR|ADMIN via
 * `auth.roleId` (triage operation). Replaces the whole `tags` array and sets
 * `priority`. When the priority actually changes, recomputes the SLA dueDate
 * from org fraud config minutes and resets (or creates) CaseSlaTracking,
 * mirroring the reopen path; when priority is unchanged the SLA is left
 * untouched. Records PRIORITY_CHANGED / TAGS_UPDATED timeline events for
 * whichever fields changed, plus an UPDATE_PRIORITY_TAGS audit entry. A no-op
 * (nothing changed) is rejected with INVARIANT_VIOLATION to keep history clean.
 */
export function createUpdateCasePriorityTagsUseCase(deps: UpdateCasePriorityTagsDeps) {
  return async function updateCasePriorityTags(
    input: UpdateCasePriorityTagsInput,
  ): Promise<Case> {
    requireRole(input.auth, UPDATE_PRIORITY_TAGS_ROLES);
    const organizationId = requireTenantContext(input.auth);
    const caseId = createCaseId(input.caseId);
    const nextPriority = createCasePriority(input.priority);
    const nextTags = normalizeTags(input.tags);

    return deps.unitOfWork.withTransaction(async (tx) => {
      const existing = await deps.cases.findById(caseId, tx);
      if (existing === null || existing.deletedAt !== null) {
        throw caseNotFound(caseId);
      }
      if (existing.organizationId !== organizationId) {
        throw forbiddenCrossTenant('case does not belong to the actor organization');
      }

      const previousPriority = existing.priority;
      const previousTags = [...existing.tags];
      const priorityChanged = previousPriority !== nextPriority;
      const tagsChanged = !arraysEqual(previousTags, nextTags);
      if (!priorityChanged && !tagsChanged) {
        throw invariantViolation('no priority or tags changes to apply', { caseId });
      }

      const now = deps.clock.now();
      let updated = existing.updatePriorityAndTags(nextPriority, nextTags, now);

      if (priorityChanged) {
        const config = await deps.fraudConfig.findByOrganization(organizationId, tx);
        if (!config) {
          throw organizationFraudConfigNotFound(organizationId);
        }
        const minutes = config.slaMinutesFor(nextPriority);
        const dueDate = fromDate(new Date(toDate(now).getTime() + minutes * MS_PER_MINUTE));

        const existingTracking = await deps.slaTracking.findByCaseId(updated.id, tx);
        const tracking =
          existingTracking !== null
            ? existingTracking.reset(dueDate, now)
            : CaseSlaTracking.create({
                id: deps.generateCaseSlaTrackingId(),
                caseId: updated.id,
                dueDate,
                now,
              });
        await deps.slaTracking.save(tracking, tx);
        updated = updated.withDueDate(dueDate, now);
      }

      await deps.cases.save(updated, tx);

      if (priorityChanged) {
        await deps.timelineRecorder.record(
          CaseTimelineEvent.create({
            id: deps.generateTimelineEventId(),
            caseId: updated.id,
            eventType: 'PRIORITY_CHANGED',
            previousValue: previousPriority,
            newValue: nextPriority,
            createdBy: input.auth.userId,
            createdAt: now,
          }),
          tx,
        );
      }
      if (tagsChanged) {
        await deps.timelineRecorder.record(
          CaseTimelineEvent.create({
            id: deps.generateTimelineEventId(),
            caseId: updated.id,
            eventType: 'TAGS_UPDATED',
            previousValue: previousTags.join(',') || null,
            newValue: nextTags.join(',') || null,
            createdBy: input.auth.userId,
            createdAt: now,
          }),
          tx,
        );
      }

      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: 'UPDATE_PRIORITY_TAGS',
          resource: 'case',
          resourceId: updated.id,
          detail: {
            previousPriority,
            newPriority: nextPriority,
            priorityChanged,
            previousTags,
            newTags: nextTags,
            tagsChanged,
          },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );

      return updated;
    });
  };
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((value, index) => value === b[index]);
}
