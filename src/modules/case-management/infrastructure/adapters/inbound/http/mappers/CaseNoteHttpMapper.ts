import type { CaseNote } from '../../../../../domain/model/aggregates/CaseNote.js';

export interface CaseNoteDto {
  readonly id: string;
  readonly caseId: string;
  readonly authorId: string;
  readonly body: string;
  readonly createdAt: string;
}

export function toCaseNoteResponse(note: CaseNote): CaseNoteDto {
  return {
    id: note.id,
    caseId: note.caseId,
    authorId: note.authorId,
    body: note.body,
    createdAt: note.createdAt,
  };
}
