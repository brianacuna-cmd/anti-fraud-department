import type { OutboxEvent } from '../model/aggregates/OutboxEvent.js';
import type { Transaction } from './UnitOfWork.js';

/**
 * Outbound port for `outbox_events`. `save` MUST run inside the same
 * `Transaction` as the business mutation that produced the event, so the row
 * and the state change commit atomically (transactional outbox pattern).
 */
export interface OutboxEventRepository {
  save(event: OutboxEvent, tx?: Transaction): Promise<void>;
}
