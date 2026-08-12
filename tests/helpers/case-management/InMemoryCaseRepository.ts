import type { Case } from '../../../src/modules/case-management/domain/model/aggregates/Case.js';
import type { CaseRepository } from '../../../src/modules/case-management/domain/ports/CaseRepository.js';
import type { CaseId } from '../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import type { Transaction } from '../../../src/modules/case-management/domain/ports/UnitOfWork.js';

/** In-memory fake for unit/e2e-testing use cases and routes (mirrors `InMemoryOrganizationFraudConfigRepository`). */
export class InMemoryCaseRepository implements CaseRepository {
  private readonly byId = new Map<string, Case>();

  async save(kase: Case, _tx?: Transaction): Promise<void> {
    this.byId.set(kase.id, kase);
  }

  async findById(id: CaseId, _tx?: Transaction): Promise<Case | null> {
    return this.byId.get(id) ?? null;
  }

  all(): readonly Case[] {
    return [...this.byId.values()];
  }
}
