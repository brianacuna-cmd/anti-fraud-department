import type { Instant } from '../../../../shared/time/Instant.js';
import type { CaseSlaTracking } from '../model/aggregates/CaseSlaTracking.js';
import type { CaseId } from '../model/value-objects/CaseId.js';
import type { Transaction } from './UnitOfWork.js';

/**
 * Outbound port for the `CaseSlaTracking` aggregate (design:
 * "CaseSlaTrackingRepository"). One document per `CaseId` — uniqueness is
 * enforced by the `sla_tracking_case_unique` index, never re-checked here.
 * `claimDueForSweep` backs Slice 13's background sweep with an exclusive
 * lease claim so concurrent sweep instances never double-process a row.
 */
export interface CaseSlaTrackingRepository {
  save(tracking: CaseSlaTracking, tx?: Transaction): Promise<void>;
  findByCaseId(caseId: CaseId, tx?: Transaction): Promise<CaseSlaTracking | null>;
  /**
   * Atomically claims up to `limit` due rows (`due_date <= now`, not BREACHED,
   * not already leased) by stamping a lease marker, and returns them. A row a
   * concurrent caller has already claimed within the lease TTL is skipped, so
   * multiple sweep instances never process the same row twice. The lease is
   * released when the row is next `save`d (the marker is doc-only, never
   * written by the mapper).
   */
  claimDueForSweep(now: Instant, limit: number, tx?: Transaction): Promise<CaseSlaTracking[]>;
}
