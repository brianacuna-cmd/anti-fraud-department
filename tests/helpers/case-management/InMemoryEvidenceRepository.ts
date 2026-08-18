import type { Evidence } from '../../../src/modules/case-management/domain/model/aggregates/Evidence.js';
import type { EvidenceRepository } from '../../../src/modules/case-management/domain/ports/EvidenceRepository.js';
import type { CaseId } from '../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import type { EvidenceId } from '../../../src/modules/case-management/domain/model/value-objects/EvidenceId.js';

/** In-memory `EvidenceRepository` fake — append-only, oldest-first by insertion. */
export class InMemoryEvidenceRepository implements EvidenceRepository {
  private readonly items: Evidence[] = [];

  async save(evidence: Evidence): Promise<void> {
    this.items.push(evidence);
  }

  async findById(id: EvidenceId): Promise<Evidence | null> {
    return this.items.find((evidence) => (evidence.id as string) === (id as string)) ?? null;
  }

  async listByCaseId(caseId: CaseId): Promise<Evidence[]> {
    return this.items.filter((evidence) => (evidence.caseId as string) === (caseId as string));
  }
}
