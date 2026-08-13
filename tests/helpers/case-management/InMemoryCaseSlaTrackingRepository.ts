import type { Instant } from '../../../src/shared/time/Instant.js';
import type { CaseSlaTracking } from '../../../src/modules/case-management/domain/model/aggregates/CaseSlaTracking.js';
import type { CaseSlaTrackingRepository } from '../../../src/modules/case-management/domain/ports/CaseSlaTrackingRepository.js';
import type { CaseId } from '../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import type { Transaction } from '../../../src/modules/case-management/domain/ports/UnitOfWork.js';

/** In-memory fake for unit-testing SLA application use cases. */
export class InMemoryCaseSlaTrackingRepository implements CaseSlaTrackingRepository {
  private readonly byCaseId = new Map<string, CaseSlaTracking>();

  async save(tracking: CaseSlaTracking, _tx?: Transaction): Promise<void> {
    this.byCaseId.set(tracking.caseId, tracking);
  }

  async findByCaseId(caseId: CaseId, _tx?: Transaction): Promise<CaseSlaTracking | null> {
    return this.byCaseId.get(caseId) ?? null;
  }

  async findDueForSweep(now: Instant, _tx?: Transaction): Promise<CaseSlaTracking[]> {
    return [...this.byCaseId.values()].filter(
      (tracking) => tracking.status !== 'BREACHED' && tracking.dueDate <= now,
    );
  }

  all(): readonly CaseSlaTracking[] {
    return [...this.byCaseId.values()];
  }
}
