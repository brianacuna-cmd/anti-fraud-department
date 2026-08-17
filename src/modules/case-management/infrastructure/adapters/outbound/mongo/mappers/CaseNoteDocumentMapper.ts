import { ObjectId } from 'mongodb';
import { fromDate, toDate } from '../../../../../../../shared/time/Instant.js';
import { CaseNote } from '../../../../../domain/model/aggregates/CaseNote.js';
import { createCaseNoteId } from '../../../../../domain/model/value-objects/CaseNoteId.js';
import { createCaseId } from '../../../../../domain/model/value-objects/CaseId.js';
import type { CaseNoteDocument } from '../documents/CaseNoteDocument.js';

/** camelCase (domain) -> snake_case (Mongo). Instant fields become BSON `Date`. */
export function toDocument(note: CaseNote): CaseNoteDocument {
  return {
    _id: new ObjectId(note.id),
    case_id: new ObjectId(note.caseId),
    organization_id: new ObjectId(note.organizationId),
    author_id: note.authorId,
    body: note.body,
    created_at: toDate(note.createdAt),
  };
}

/** snake_case (Mongo) -> camelCase (domain). */
export function toDomain(document: CaseNoteDocument): CaseNote {
  return CaseNote.rehydrate({
    id: createCaseNoteId(document._id.toString()),
    caseId: createCaseId(document.case_id.toString()),
    organizationId: document.organization_id.toString(),
    authorId: document.author_id,
    body: document.body,
    createdAt: fromDate(document.created_at),
  });
}
