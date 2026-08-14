import type { Instant } from '../../../../shared/time/Instant.js';
import type { CustomerOutgoingEvent } from '../model/aggregates/CustomerOutgoingEvent.js';
import type { CustomerOutgoingEventId } from '../model/value-objects/CustomerOutgoingEventId.js';
import type { EnforcementActionId } from '../model/value-objects/EnforcementActionId.js';
import type { Transaction } from './UnitOfWork.js';

export interface CustomerOutgoingEventRepository {
  save(event: CustomerOutgoingEvent, tx?: Transaction): Promise<void>;
  findById(id: CustomerOutgoingEventId, tx?: Transaction): Promise<CustomerOutgoingEvent | null>;
  findByEnforcementActionId(
    enforcementActionId: EnforcementActionId,
    tx?: Transaction,
  ): Promise<CustomerOutgoingEvent | null>;
  /**
   * Claims PENDING outbox rows due for delivery (`attempts < 5` and backoff elapsed).
   * Ordering is oldest-first by `last_attempt_at` / `created_at`.
   */
  claimPending(now: Instant, limit: number, tx?: Transaction): Promise<CustomerOutgoingEvent[]>;
}
