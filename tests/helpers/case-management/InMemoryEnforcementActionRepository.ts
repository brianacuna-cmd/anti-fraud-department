import type { EnforcementAction } from '../../../src/modules/case-management/domain/model/aggregates/EnforcementAction.js';
import type {
  EnforcementActionRepository,
  EnforcementActionListQuery,
  EnforcementActionListResult,
} from '../../../src/modules/case-management/domain/ports/EnforcementActionRepository.js';
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

  async list(query: EnforcementActionListQuery, _tx?: Transaction): Promise<EnforcementActionListResult> {
    const matched = [...this.byId.values()]
      .filter((action) => matchesQuery(action, query))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    return {
      items: matched.slice(query.offset, query.offset + query.limit),
      total: matched.length,
    };
  }

  all(): readonly EnforcementAction[] {
    return [...this.byId.values()];
  }
}

function matchesQuery(action: EnforcementAction, query: EnforcementActionListQuery): boolean {
  if ((action.organizationId as string) !== query.organizationId) return false;
  if (query.caseId !== undefined && (action.caseId as string) !== query.caseId) return false;
  if (query.status !== undefined && action.status !== query.status) return false;
  if (query.actionType !== undefined && action.actionType !== query.actionType) return false;
  if (query.targetType !== undefined && action.targetType !== query.targetType) return false;
  if (query.targetId !== undefined && action.targetId !== query.targetId) return false;
  return true;
}
