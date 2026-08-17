import type { Resolution } from '../model/aggregates/Resolution.js';
import type { CaseId } from '../model/value-objects/CaseId.js';
import type { Transaction } from './UnitOfWork.js';

/**
 * Outbound port for `resolutions` (append-only, 1:N per case). `save` takes an
 * optional `Transaction` so a resolution commits atomically with the case
 * status transition, its STATE_CHANGED timeline event and audit row.
 */
export interface ResolutionRepository {
  save(resolution: Resolution, tx?: Transaction): Promise<void>;
  listByCaseId(caseId: CaseId, tx?: Transaction): Promise<Resolution[]>;
}
