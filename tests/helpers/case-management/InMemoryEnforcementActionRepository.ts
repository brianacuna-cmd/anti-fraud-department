import type { EnforcementAction } from '../../../src/modules/case-management/domain/model/aggregates/EnforcementAction.js';
import type { EnforcementActionRepository } from '../../../src/modules/case-management/domain/ports/EnforcementActionRepository.js';
import type { EnforcementActionId } from '../../../src/modules/case-management/domain/model/value-objects/EnforcementActionId.js';
import type { CaseId } from '../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import type { Transaction } from '../../../src/modules/case-management/domain/ports/UnitOfWork.js';

export class InMemoryEnforcementActionRepository implements EnforcementActionRepository {
  private readonly byId = new Map<string, EnforcementAction>();

  async save(action: EnforcementAction, _tx?: Transaction): Promise<void> {
    this.byId.set(action.id, action);
  }

  async findById(id: EnforcementActionId, _tx?: Transaction): Promise<EnforcementAction | null> {
    return this.byId.get(id) ?? null;
  }

  async findByCaseId(caseId: CaseId, _tx?: Transaction): Promise<EnforcementAction[]> {
    return [...this.byId.values()].filter((action) => action.caseId === caseId);
  }

  all(): readonly EnforcementAction[] {
    return [...this.byId.values()];
  }
}
