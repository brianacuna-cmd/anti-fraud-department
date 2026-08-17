import type { CaseNote } from '../../../src/modules/case-management/domain/model/aggregates/CaseNote.js';
import type { CaseNoteRepository } from '../../../src/modules/case-management/domain/ports/CaseNoteRepository.js';
import type { CaseId } from '../../../src/modules/case-management/domain/model/value-objects/CaseId.js';

/** In-memory `CaseNoteRepository` fake — append-only, oldest-first by insertion. */
export class InMemoryCaseNoteRepository implements CaseNoteRepository {
  private readonly notes: CaseNote[] = [];

  async save(note: CaseNote): Promise<void> {
    this.notes.push(note);
  }

  async listByCaseId(caseId: CaseId): Promise<CaseNote[]> {
    return this.notes.filter((note) => (note.caseId as string) === (caseId as string));
  }
}
