import type { EnforcementAction } from '../model/aggregates/EnforcementAction.js';
import type { EnforcementActionId } from '../model/value-objects/EnforcementActionId.js';
import type { CaseId } from '../model/value-objects/CaseId.js';
import type { Transaction } from './UnitOfWork.js';

export interface EnforcementActionRepository {
  save(action: EnforcementAction, tx?: Transaction): Promise<void>;
  findById(id: EnforcementActionId, tx?: Transaction): Promise<EnforcementAction | null>;
  findByCaseId(caseId: CaseId, tx?: Transaction): Promise<EnforcementAction[]>;
}
