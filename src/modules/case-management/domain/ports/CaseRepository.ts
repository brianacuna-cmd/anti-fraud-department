import type { Case } from '../model/aggregates/Case.js';
import type { CaseId } from '../model/value-objects/CaseId.js';
import type { Transaction } from './UnitOfWork.js';

/**
 * Outbound port for the `Case` aggregate. `list()` (inbox query, T3) lands
 * in a later slice — Slice 1 only needs `save`/`findById` for the contract
 * test's round-trip.
 */
export interface CaseRepository {
  save(kase: Case, tx?: Transaction): Promise<void>;
  findById(id: CaseId, tx?: Transaction): Promise<Case | null>;
}
