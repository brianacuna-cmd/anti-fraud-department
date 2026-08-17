import type { CaseNote } from '../model/aggregates/CaseNote.js';
import type { CaseId } from '../model/value-objects/CaseId.js';
import type { Transaction } from './UnitOfWork.js';

/**
 * Outbound port for `case_notes` (append-only). `save` takes an optional
 * `Transaction` so a note commits atomically with its `NOTE_ADDED` timeline
 * event and audit row. `listByCaseId` backs the ficha, oldest-first.
 */
export interface CaseNoteRepository {
  save(note: CaseNote, tx?: Transaction): Promise<void>;
  listByCaseId(caseId: CaseId, tx?: Transaction): Promise<CaseNote[]>;
}
