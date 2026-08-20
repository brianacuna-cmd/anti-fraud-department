import { toDate, type Instant } from '../../../src/shared/time/Instant.js';
import type { CaseSlaTracking } from '../../../src/modules/case-management/domain/model/aggregates/CaseSlaTracking.js';
import type { CaseSlaTrackingRepository } from '../../../src/modules/case-management/domain/ports/CaseSlaTrackingRepository.js';
import type { CaseId } from '../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import type { Transaction } from '../../../src/modules/case-management/domain/ports/UnitOfWork.js';

const LEASE_TTL_MS = 5 * 60 * 1000;

/** In-memory fake for unit-testing SLA application use cases. */
export class InMemoryCaseSlaTrackingRepository implements CaseSlaTrackingRepository {
  private readonly byCaseId = new Map<string, CaseSlaTracking>();
  /** Sweep lease markers (caseId -> claim epoch ms), mirroring the Mongo `claimed_at` marker. */
  private readonly claimedAtMs = new Map<string, number>();

  async save(tracking: CaseSlaTracking, _tx?: Transaction): Promise<void> {
    this.byCaseId.set(tracking.caseId, tracking);
    // A save releases the lease (the Mongo mapper never writes `claimed_at`).
    this.claimedAtMs.delete(tracking.caseId);
  }

  async findByCaseId(caseId: CaseId, _tx?: Transaction): Promise<CaseSlaTracking | null> {
    return this.byCaseId.get(caseId) ?? null;
  }

  async claimDueForSweep(now: Instant, limit: number, _tx?: Transaction): Promise<CaseSlaTracking[]> {
    const nowMs = toDate(now).getTime();
    const leaseExpiry = nowMs - LEASE_TTL_MS;
    const due = [...this.byCaseId.values()]
      .filter((tracking) => tracking.status !== 'BREACHED' && tracking.dueDate <= now)
      .sort((a, b) => toDate(a.dueDate).getTime() - toDate(b.dueDate).getTime());

    const claimed: CaseSlaTracking[] = [];
    for (const tracking of due) {
      if (claimed.length >= limit) {
        break;
      }
      const existingClaim = this.claimedAtMs.get(tracking.caseId);
      const isFree = existingClaim === undefined || existingClaim <= leaseExpiry;
      if (isFree) {
        this.claimedAtMs.set(tracking.caseId, nowMs);
        claimed.push(tracking);
      }
    }
    return claimed;
  }

  all(): readonly CaseSlaTracking[] {
    return [...this.byCaseId.values()];
  }
}
