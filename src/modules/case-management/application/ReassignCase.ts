import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { CaseRepository } from '../domain/ports/CaseRepository.js';
import type { TimelineRecorder } from '../domain/ports/TimelineRecorder.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { AssigneeDirectory } from '../domain/ports/AssigneeDirectory.js';
import type { TimelineEventId } from '../domain/model/value-objects/TimelineEventId.js';
import type { Case } from '../domain/model/aggregates/Case.js';
import { CaseTimelineEvent } from '../domain/model/aggregates/CaseTimelineEvent.js';
import { createAssignedTo } from '../domain/model/value-objects/AssignedTo.js';
import { createCaseId } from '../domain/model/value-objects/CaseId.js';
import {
  caseNotFound,
  forbiddenCrossTenant,
  invariantViolation,
} from '../domain/errors/CaseManagementError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface ReassignCaseInput {
  readonly auth: AuthContext;
  readonly caseId: string;
  readonly assignedToType: string;
  readonly assignedToId: string;
}

export interface ReassignCaseDeps {
  readonly cases: CaseRepository;
  readonly timelineRecorder: TimelineRecorder;
  readonly auditRecorder: AuditRecorder;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly generateTimelineEventId: () => TimelineEventId;
  readonly assigneeDirectory: AssigneeDirectory;
}

/**
 * Manual case reassignment (PR2). Loads the case, enforces tenant + soft-delete
 * gates, validates the assignee belongs to the organization, then clones the
 * RouteCase audit/timeline pattern with `trigger: MANUAL`. Does NOT dispatch
 * notifications (CASO_ASIGNADO is out of scope).
 *
 * Same-assignee is rejected with INVARIANT_VIOLATION to keep history clean.
 */
export function createReassignCaseUseCase(deps: ReassignCaseDeps) {
  return async function reassignCase(input: ReassignCaseInput): Promise<Case> {
    const organizationId = requireTenantContext(input.auth);
    const caseId = createCaseId(input.caseId);
    const assignedTo = createAssignedTo(input.assignedToType, input.assignedToId);

    return deps.unitOfWork.withTransaction(async (tx) => {
      const existing = await deps.cases.findById(caseId, tx);
      if (existing === null || existing.deletedAt !== null) {
        throw caseNotFound(caseId);
      }
      if (existing.organizationId !== organizationId) {
        throw forbiddenCrossTenant('case does not belong to the actor organization');
      }

      const sameAssignee =
        existing.assignedTo !== null &&
        existing.assignedTo.type === assignedTo.type &&
        existing.assignedTo.id === assignedTo.id;
      if (sameAssignee) {
        throw invariantViolation('case is already assigned to this assignee', {
          caseId,
          assignedToType: assignedTo.type,
          assignedToId: assignedTo.id,
        });
      }

      const inOrg = await deps.assigneeDirectory.belongsToOrganization(organizationId, assignedTo);
      if (!inOrg) {
        throw forbiddenCrossTenant('assignee does not belong to the case organization');
      }

      const now = deps.clock.now();
      const previousAssigneeId = existing.assignedTo?.id ?? null;
      const updated = existing.reassign(assignedTo, now);
      await deps.cases.save(updated, tx);

      const timelineEvent = CaseTimelineEvent.create({
        id: deps.generateTimelineEventId(),
        caseId: updated.id,
        eventType: 'ASSIGNED',
        previousValue: previousAssigneeId,
        newValue: assignedTo.id,
        createdBy: input.auth.userId,
        createdAt: now,
      });
      await deps.timelineRecorder.record(timelineEvent, tx);

      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: 'REASSIGN_CASE',
          resource: 'case',
          resourceId: updated.id,
          detail: {
            trigger: 'MANUAL',
            assignedToId: assignedTo.id,
            assignedToType: assignedTo.type,
            previousAssignedToId: previousAssigneeId,
            previousAssignedToType: existing.assignedTo?.type ?? null,
          },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );

      return updated;
    });
  };
}
