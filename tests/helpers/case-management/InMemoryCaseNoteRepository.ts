import type { CaseNote } from '../../../src/modules/case-management/domain/model/aggregates/CaseNote.js';
import type { CaseNoteRepository } from '../../../src/modules/case-management/domain/ports/CaseNoteRepository.js';
import type { CaseId } from '../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import type { CaseNoteId } from '../../../src/modules/case-management/domain/model/value-objects/CaseNoteId.js';

/** In-memory `CaseNoteRepository` fake — upsert-by-id, oldest-first by insertion. */
export class InMemoryCaseNoteRepository implements CaseNoteRepository {
  private readonly notes: CaseNote[] = [];

  async save(note: CaseNote): Promise<void> {
    const index = this.notes.findIndex((item) => (item.id as string) === (note.id as string));
    if (index === -1) {
      this.notes.push(note);
    } else {
      this.notes[index] = note;
    }
  }

  /** Returns the row regardless of `deletedAt` so the soft-delete path is idempotent. */
  async findById(id: CaseNoteId): Promise<CaseNote | null> {
    return this.notes.find((note) => (note.id as string) === (id as string)) ?? null;
  }

  async listByCaseId(caseId: CaseId): Promise<CaseNote[]> {
    return this.notes.filter(
      (note) => (note.caseId as string) === (caseId as string) && note.deletedAt === null,
    );
  }
}
