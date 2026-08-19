import { oid } from '../../../support/oid.js';
import { createDeleteCaseNoteUseCase } from '../../../../src/modules/case-management/application/DeleteCaseNote.js';
import { CaseNote } from '../../../../src/modules/case-management/domain/model/aggregates/CaseNote.js';
import { createCaseNoteId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseNoteId.js';
import { createCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { generateTimelineEventId } from '../../../../src/modules/case-management/domain/model/value-objects/TimelineEventId.js';
import { InMemoryCaseNoteRepository } from '../../../helpers/case-management/InMemoryCaseNoteRepository.js';
import { InMemoryTimelineRecorder } from '../../../helpers/case-management/InMemoryTimelineRecorder.js';
import { InMemoryCaseManagementAuditRecorder } from '../../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/case-management/infrastructure/PassthroughUnitOfWork.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { CaseManagementError } from '../../../../src/modules/case-management/domain/errors/CaseManagementError.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_1 = oid('org-1');
const ORG_2 = oid('org-2');
const NOTE_ID = oid('note-1');
const CASE_ID = oid('case-1');

const SUPERVISOR = createAuthContext({ userId: oid('sup-1'), organizationId: ORG_1, actorType: 'USER', roleId: 'SUPERVISOR' });
const ANALYST = createAuthContext({ userId: oid('an-1'), organizationId: ORG_1, actorType: 'USER', roleId: 'ANALYST' });

function buildNote(organizationId = ORG_1): CaseNote {
  return CaseNote.create({
    id: createCaseNoteId(NOTE_ID),
    caseId: createCaseId(CASE_ID),
    organizationId,
    authorId: oid('an-1'),
    body: 'wrong note',
    now: NOW,
  });
}

function build(seed?: CaseNote) {
  const notes = new InMemoryCaseNoteRepository();
  if (seed) void notes.save(seed);
  const timelineRecorder = new InMemoryTimelineRecorder();
  const auditRecorder = new InMemoryCaseManagementAuditRecorder();
  const deleteCaseNote = createDeleteCaseNoteUseCase({
    notes,
    timelineRecorder,
    auditRecorder,
    unitOfWork: new PassthroughUnitOfWork(),
    clock: new FixedClock(NOW),
    generateTimelineEventId,
  });
  return { deleteCaseNote, notes, timelineRecorder, auditRecorder };
}

describe('createDeleteCaseNoteUseCase', () => {
  it('soft-deletes a note and records NOTE_DELETED + DELETE_CASE_NOTE', async () => {
    const h = build(buildNote());

    const result = await h.deleteCaseNote({ auth: SUPERVISOR, noteId: NOTE_ID });

    expect(result.deletedAt).toEqual(NOW);
    expect((await h.notes.findById(createCaseNoteId(NOTE_ID)))?.deletedAt).toEqual(NOW);
    expect(h.timelineRecorder.all()[0]?.eventType).toBe('NOTE_DELETED');
    expect(h.auditRecorder.all()[0]?.action).toBe('DELETE_CASE_NOTE');
  });

  it('hides soft-deleted notes from listByCaseId', async () => {
    const h = build(buildNote());
    await h.deleteCaseNote({ auth: SUPERVISOR, noteId: NOTE_ID });
    expect(await h.notes.listByCaseId(createCaseId(CASE_ID))).toHaveLength(0);
  });

  it('is idempotent: re-deleting is a no-op', async () => {
    const h = build(buildNote());
    await h.deleteCaseNote({ auth: SUPERVISOR, noteId: NOTE_ID });
    await h.deleteCaseNote({ auth: SUPERVISOR, noteId: NOTE_ID });
    expect(h.timelineRecorder.all()).toHaveLength(1);
    expect(h.auditRecorder.all()).toHaveLength(1);
  });

  it('rejects ANALYST with FORBIDDEN_ROLE', async () => {
    const h = build(buildNote());
    await expect(h.deleteCaseNote({ auth: ANALYST, noteId: NOTE_ID })).rejects.toMatchObject({
      code: 'FORBIDDEN_ROLE',
    } satisfies Partial<CaseManagementError>);
  });

  it('throws CASE_NOTE_NOT_FOUND when missing', async () => {
    const h = build();
    await expect(h.deleteCaseNote({ auth: SUPERVISOR, noteId: oid('missing') })).rejects.toMatchObject({
      code: 'CASE_NOTE_NOT_FOUND',
    });
  });

  it('rejects cross-tenant with FORBIDDEN_CROSS_TENANT', async () => {
    const h = build(buildNote(ORG_2));
    await expect(h.deleteCaseNote({ auth: SUPERVISOR, noteId: NOTE_ID })).rejects.toMatchObject({
      code: 'FORBIDDEN_CROSS_TENANT',
    });
  });
});
