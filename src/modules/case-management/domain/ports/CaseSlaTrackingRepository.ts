import type { Instant } from '../../../../shared/time/Instant.js';
import type { CaseSlaTracking } from '../model/aggregates/CaseSlaTracking.js';
import type { CaseId } from '../model/value-objects/CaseId.js';
import type { Transaction } from './UnitOfWork.js';

/**
 * Outbound port for the `CaseSlaTracking` aggregate (design:
 * "CaseSlaTrackingRepository"). One document per `CaseId` — uniqueness is
 * enforced by the `sla_tracking_case_unique` index, never re-checked here.
 * `findDueForSweep` backs Slice 13's background sweep — this slice only
 * needs its query shape to be correct against the `DueDateAt` BSON mirror.
 */
export interface CaseSlaTrackingRepository {
  save(tracking: CaseSlaTracking, tx?: Transaction): Promise<void>;
  findByCaseId(caseId: CaseId, tx?: Transaction): Promise<CaseSlaTracking | null>;
  findDueForSweep(now: Instant, tx?: Transaction): Promise<CaseSlaTracking[]>;
}
