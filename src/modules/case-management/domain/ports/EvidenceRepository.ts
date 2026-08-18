import type { Evidence } from '../model/aggregates/Evidence.js';
import type { CaseId } from '../model/value-objects/CaseId.js';
import type { EvidenceId } from '../model/value-objects/EvidenceId.js';
import type { Transaction } from './UnitOfWork.js';

/**
 * Outbound port for `evidence` metadata (append-only; the blob lives in
 * `EvidenceStore`). `listByCaseId` backs the ficha; `findById` backs the
 * detail + download endpoints (tenant gate applied by the use case).
 */
export interface EvidenceRepository {
  save(evidence: Evidence, tx?: Transaction): Promise<void>;
  findById(id: EvidenceId, tx?: Transaction): Promise<Evidence | null>;
  listByCaseId(caseId: CaseId, tx?: Transaction): Promise<Evidence[]>;
}
