import type { Investigation } from '../model/aggregates/Investigation.js';
import type { CaseId } from '../model/value-objects/CaseId.js';
import type { InvestigationId } from '../model/value-objects/InvestigationId.js';
import type { Transaction } from './UnitOfWork.js';

/**
 * Outbound port for `investigations` (1:N per case). `save` is upsert (open +
 * later close). `listByCaseId` backs the ficha; `findById` backs the detail
 * endpoint (tenant gate is applied by the use case, mirroring `GetCase`).
 */
export interface InvestigationRepository {
  save(investigation: Investigation, tx?: Transaction): Promise<void>;
  findById(id: InvestigationId, tx?: Transaction): Promise<Investigation | null>;
  listByCaseId(caseId: CaseId, tx?: Transaction): Promise<Investigation[]>;
}
