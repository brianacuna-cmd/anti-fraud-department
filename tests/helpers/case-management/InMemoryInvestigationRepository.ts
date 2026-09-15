import type { Investigation } from '../../../src/modules/case-management/domain/model/aggregates/Investigation.js';
import type { InvestigationRepository } from '../../../src/modules/case-management/domain/ports/InvestigationRepository.js';
import type { CaseId } from '../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import type { InvestigationId } from '../../../src/modules/case-management/domain/model/value-objects/InvestigationId.js';

/** In-memory `InvestigationRepository` fake. `save` upserts by id; list is oldest-first by insertion. */
export class InMemoryInvestigationRepository implements InvestigationRepository {
  private readonly byId = new Map<string, Investigation>();
  private readonly order: string[] = [];

  async save(investigation: Investigation): Promise<void> {
    if (!this.byId.has(investigation.id)) {
      this.order.push(investigation.id);
    }
    this.byId.set(investigation.id, investigation);
  }

  async findById(id: InvestigationId): Promise<Investigation | null> {
    return this.byId.get(id) ?? null;
  }

  async listByCaseId(caseId: CaseId): Promise<Investigation[]> {
    return this.order
      .map((id) => this.byId.get(id)!)
      .filter((investigation) => (investigation.caseId as string) === (caseId as string));
  }

  /** Test-only: every stored investigation, oldest-first by insertion. */
  all(): Investigation[] {
    return this.order.map((id) => this.byId.get(id)!);
  }
}
