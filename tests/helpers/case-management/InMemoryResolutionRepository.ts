import type { Resolution } from '../../../src/modules/case-management/domain/model/aggregates/Resolution.js';
import type { ResolutionRepository } from '../../../src/modules/case-management/domain/ports/ResolutionRepository.js';
import type { CaseId } from '../../../src/modules/case-management/domain/model/value-objects/CaseId.js';

/** In-memory `ResolutionRepository` fake — append-only, oldest-first by insertion. */
export class InMemoryResolutionRepository implements ResolutionRepository {
  private readonly resolutions: Resolution[] = [];

  async save(resolution: Resolution): Promise<void> {
    this.resolutions.push(resolution);
  }

  async listByCaseId(caseId: CaseId): Promise<Resolution[]> {
    return this.resolutions.filter((resolution) => (resolution.caseId as string) === (caseId as string));
  }
}
