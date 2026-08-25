import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { CaseNote } from '../domain/model/aggregates/CaseNote.js';
import type { CaseNoteRepository } from '../domain/ports/CaseNoteRepository.js';
import type { TimelineRecorder } from '../domain/ports/TimelineRecorder.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import type { TimelineEventId } from '../domain/model/value-objects/TimelineEventId.js';
import { CaseTimelineEvent } from '../domain/model/aggregates/CaseTimelineEvent.js';
import { createCaseNoteId } from '../domain/model/value-objects/CaseNoteId.js';
import { caseNoteNotFound, forbiddenCrossTenant } from '../domain/errors/CaseManagementError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireOperationalRole, SUPERVISION_ROLES } from './authorization/policy.js';

export interface DeleteCaseNoteInput {
  readonly auth: AuthContext;
  readonly noteId: string;
}

export interface DeleteCaseNoteDeps {
  readonly notes: CaseNoteRepository;
  readonly timelineRecorder: TimelineRecorder;
  readonly auditRecorder: AuditRecorder;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly generateTimelineEventId: () => TimelineEventId;
}

/**
 * DELETE /notes/:id — logical (soft) delete. Role-gated to SUPERVISOR.
 * Marks `deletedAt = now` so an erroneous note is hidden from the case file without
 * dropping the row (append-only history + referential integrity preserved).
 * Idempotent: re-deleting an already-deleted note is a no-op. Records
 * NOTE_DELETED timeline + DELETE_CASE_NOTE audit.
 * Scope: case_notes, case_timeline, audit_logs.
 */
export function createDeleteCaseNoteUseCase(deps: DeleteCaseNoteDeps) {
  return async function deleteCaseNote(input: DeleteCaseNoteInput): Promise<CaseNote> {
    requireOperationalRole(input.auth, SUPERVISION_ROLES);
    const organizationId = requireTenantContext(input.auth);
    const noteId = createCaseNoteId(input.noteId);

    return deps.unitOfWork.withTransaction(async (tx) => {
      const existing = await deps.notes.findById(noteId, tx);
      if (existing === null) {
        throw caseNoteNotFound(noteId);
      }
      if (existing.organizationId !== organizationId) {
        throw forbiddenCrossTenant('case note does not belong to the actor organization');
      }
      if (existing.deletedAt !== null) {
        return existing;
      }

      const now = deps.clock.now();
      const deleted = existing.softDelete(now);
      await deps.notes.save(deleted, tx);

      await deps.timelineRecorder.record(
        CaseTimelineEvent.create({
          id: deps.generateTimelineEventId(),
          caseId: deleted.caseId,
          eventType: 'NOTE_DELETED',
          previousValue: deleted.id,
          newValue: null,
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
          action: 'DELETE_CASE_NOTE',
          resource: 'case',
          resourceId: deleted.id,
          detail: { caseId: deleted.caseId },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );

      return deleted;
    });
  };
}
