import type { AnalystDecision } from '../model/aggregates/AnalystDecision.js';
import type { AnalystDecisionId } from '../model/value-objects/AnalystDecisionId.js';
import type { CaseId } from '../model/value-objects/CaseId.js';
import type { Transaction } from './UnitOfWork.js';

export interface AnalystDecisionRepository {
  save(decision: AnalystDecision, tx?: Transaction): Promise<void>;
  findById(id: AnalystDecisionId, tx?: Transaction): Promise<AnalystDecision | null>;
  findByCaseId(caseId: CaseId, tx?: Transaction): Promise<AnalystDecision[]>;
}
