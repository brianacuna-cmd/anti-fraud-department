import type { OutboxEvent } from './OutboxEvent.js';

/**
 * Shared outbound port for `outbox_events`. `save` MUST run inside the same
 * transaction as the business mutation that produced the event. `tx` is the
 * caller module's opaque transaction handle (never inspected here), so it is
 * typed `unknown` to keep the shared port decoupled from any module's
 * `UnitOfWork`. The Mongo adapter casts it back to a `ClientSession`.
 */
export interface OutboxEventRepository {
  save(event: OutboxEvent, tx?: unknown): Promise<void>;
}
