import { oid } from '../../../../support/oid.js';
import { CaseNote } from '../../../../../src/modules/case-management/domain/model/aggregates/CaseNote.js';
import { createCaseId } from '../../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { createCaseNoteId } from '../../../../../src/modules/case-management/domain/model/value-objects/CaseNoteId.js';
import { fromDate } from '../../../../../src/shared/time/Instant.js';
import { CaseManagementError } from '../../../../../src/modules/case-management/domain/errors/CaseManagementError.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

function build(body: string): CaseNote {
  return CaseNote.create({
    id: createCaseNoteId(oid('note-1')),
    caseId: createCaseId(oid('case-1')),
    organizationId: oid('org-1'),
    authorId: oid('analyst-1'),
    body,
    now: NOW,
  });
}

describe('CaseNote', () => {
  it('creates a note, trimming the body', () => {
    const note = build('  hello world  ');
    expect(note.body).toBe('hello world');
    expect(note.caseId).toBe(oid('case-1'));
    expect(note.authorId).toBe(oid('analyst-1'));
  });

  it('rejects a blank body', () => {
    expect(() => build('   ')).toThrow(CaseManagementError);
  });
});
