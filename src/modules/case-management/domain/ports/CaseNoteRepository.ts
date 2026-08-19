import type { CaseNote } from '../model/aggregates/CaseNote.js';
import type { CaseId } from '../model/value-objects/CaseId.js';
import type { CaseNoteId } from '../model/value-objects/CaseNoteId.js';
import type { Transaction } from './UnitOfWork.js';

/**
 * Outbound port for `case_notes`. `save` is an upsert (append + soft-delete)
 * and takes an optional `Transaction` so a note commits atomically with its
 * timeline event and audit row. `findById` backs the soft-delete path and
 * returns rows regardless of `deleted_at` (idempotency); `listByCaseId` backs
 * the ficha, oldest-first, hiding soft-deleted notes.
 */
export interface CaseNoteRepository {
  save(note: CaseNote, tx?: Transaction): Promise<void>;
  findById(id: CaseNoteId, tx?: Transaction): Promise<CaseNote | null>;
  listByCaseId(caseId: CaseId, tx?: Transaction): Promise<CaseNote[]>;
}
