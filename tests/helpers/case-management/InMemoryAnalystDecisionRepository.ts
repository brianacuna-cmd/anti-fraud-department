import type { AnalystDecision } from '../../../src/modules/case-management/domain/model/aggregates/AnalystDecision.js';
import type { AnalystDecisionRepository } from '../../../src/modules/case-management/domain/ports/AnalystDecisionRepository.js';
import type { AnalystDecisionId } from '../../../src/modules/case-management/domain/model/value-objects/AnalystDecisionId.js';
import type { CaseId } from '../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import type { Transaction } from '../../../src/modules/case-management/domain/ports/UnitOfWork.js';

export class InMemoryAnalystDecisionRepository implements AnalystDecisionRepository {
  private readonly byId = new Map<string, AnalystDecision>();

  async save(decision: AnalystDecision, _tx?: Transaction): Promise<void> {
    this.byId.set(decision.id, decision);
  }

  async findById(id: AnalystDecisionId, _tx?: Transaction): Promise<AnalystDecision | null> {
    return this.byId.get(id) ?? null;
  }

  async findByCaseId(caseId: CaseId, _tx?: Transaction): Promise<AnalystDecision[]> {
    return [...this.byId.values()].filter((decision) => decision.caseId === caseId);
  }

  all(): readonly AnalystDecision[] {
    return [...this.byId.values()];
  }
}
