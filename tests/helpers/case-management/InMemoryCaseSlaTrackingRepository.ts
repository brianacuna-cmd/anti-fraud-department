import type { Instant } from '../../../src/shared/time/Instant.js';
import type { CaseSlaTracking } from '../../../src/modules/case-management/domain/model/aggregates/CaseSlaTracking.js';
import type { CaseSlaTrackingRepository } from '../../../src/modules/case-management/domain/ports/CaseSlaTrackingRepository.js';
import type { CaseId } from '../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import type { Transaction } from '../../../src/modules/case-management/domain/ports/UnitOfWork.js';

/**
 * In-memory fake for `CaseSlaTrackingRepository`. Keyed by `CaseId` rather
 * than by the tracking row's own id, so it enforces the same
 * one-row-per-case invariant the `sla_tracking_case_unique` index gives us
 * in Mongo — a test that accidentally inserts a second row for a case fails
 * here the same way it would in production.
 */
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

  /** Test-only accessor. */
  all(): CaseSlaTracking[] {
    return [...this.byCaseId.values()];
  }

  seed(tracking: CaseSlaTracking): void {
    this.byCaseId.set(tracking.caseId, tracking);
  }
}
