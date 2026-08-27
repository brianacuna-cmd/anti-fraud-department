import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { Case } from '../domain/model/aggregates/Case.js';
import type { CaseNote } from '../domain/model/aggregates/CaseNote.js';
import type { CaseRepository } from '../domain/ports/CaseRepository.js';
import type { CaseNoteRepository } from '../domain/ports/CaseNoteRepository.js';
import type { TimelineRecorder } from '../domain/ports/TimelineRecorder.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import type { CaseNoteId } from '../domain/model/value-objects/CaseNoteId.js';
import type { TimelineEventId } from '../domain/model/value-objects/TimelineEventId.js';
import { CaseNote as CaseNoteAggregate } from '../domain/model/aggregates/CaseNote.js';
import { CaseTimelineEvent } from '../domain/model/aggregates/CaseTimelineEvent.js';
import { createCaseId } from '../domain/model/value-objects/CaseId.js';
import { caseNotFound, forbiddenCrossTenant } from '../domain/errors/CaseManagementError.js';
import { assertAssigned } from '../domain/services/AssignmentGate.js';
import { assertNotClosed } from '../domain/services/ClosedCaseGate.js';
import { assertReviewStarted } from '../domain/services/WorkflowStepGate.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireOperationalRole, CASE_WORK_ROLES } from './authorization/policy.js';

export interface AddCaseNoteInput {
  readonly auth: AuthContext;
  readonly caseId: string;
  readonly body: string;
}

export interface AddCaseNoteDeps {
  readonly cases: CaseRepository;
  readonly notes: CaseNoteRepository;
  readonly timelineRecorder: TimelineRecorder;
  readonly auditRecorder: AuditRecorder;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly generateCaseNoteId: () => CaseNoteId;
  readonly generateTimelineEventId: () => TimelineEventId;
}

/**
 * Adds a free-text note to a case. Within ONE `unitOfWork.withTransaction`:
 * insert the note + a `NOTE_ADDED` timeline event (finally emitting the type
 * declared since Slice 3) + an `ADD_CASE_NOTE` audit row — all atomic. Any
 * authenticated tenant actor may add a note; the case must belong to the
 * actor's organization and not be soft-deleted.
 */
export function createAddCaseNoteUseCase(deps: AddCaseNoteDeps) {
  return async function addCaseNote(input: AddCaseNoteInput): Promise<CaseNote> {
    requireOperationalRole(input.auth, CASE_WORK_ROLES);
    const organizationId = requireTenantContext(input.auth);
    const caseId = createCaseId(input.caseId);

    return deps.unitOfWork.withTransaction(async (tx) => {
      const kase: Case | null = await deps.cases.findById(caseId, tx);
      if (kase === null || kase.deletedAt !== null) {
        throw caseNotFound(caseId);
      }
      if (kase.organizationId !== organizationId) {
        throw forbiddenCrossTenant('case does not belong to the actor organization');
      }
      // Without an assignee the case is frozen. See `AssignmentGate`.
      assertAssigned(kase);
      // A closed case is not worked. See `ClosedCaseGate`.
      assertNotClosed(kase);
      // Instruction comes after review. See `WorkflowStepGate`.
      assertReviewStarted(kase);

      const now = deps.clock.now();
      const note = CaseNoteAggregate.create({
        id: deps.generateCaseNoteId(),
        caseId,
        organizationId,
        authorId: input.auth.userId,
        body: input.body,
        now,
      });
      await deps.notes.save(note, tx);

      await deps.timelineRecorder.record(
        CaseTimelineEvent.create({
          id: deps.generateTimelineEventId(),
          caseId,
          eventType: 'NOTE_ADDED',
          previousValue: null,
          newValue: note.id,
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
          action: 'ADD_CASE_NOTE',
          resource: 'case',
          resourceId: caseId,
          detail: { noteId: note.id },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );

      return note;
    });
  };
}
